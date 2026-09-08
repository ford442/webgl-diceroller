/**
 * dice_physics.worker.ts
 *
 * Production physics Web Worker (Phase 4).  Hosts the custom WASM dice-physics
 * engine entirely off the main thread, self-paces a fixed-timestep simulation,
 * and publishes rigid-body transforms to the main thread.
 *
 * Transport:
 *   • Preferred: a double-buffered SharedArrayBuffer (see workerLayout.ts).  The
 *     worker copies transforms out of the WASM heap into the back buffer and
 *     atomically flips `front` — the main thread reads with zero further copies
 *     and no postMessage per frame.
 *   • Fallback (no cross-origin isolation → no SAB): the worker posts a
 *     `snapshot` message each frame with *copied* Float32Arrays.  Crucially we
 *     never transfer `engine.getTransforms().buffer` — that view aliases the
 *     entire WASM heap and transferring it would detach the module's memory.
 *
 * Collision events are sparse, so they travel via postMessage (`events`) rather
 * than through the SAB.
 *
 * Loaded from the bundle via `new Worker(new URL('./dice_physics.worker.js',
 * import.meta.url), { type: 'module' })`.
 */

import { publicAssetUrl } from '../core/publicAssetUrl.js';
import { instantiateDicePhysicsModule, WASM_SCALAR_DIR, WASM_SIMD_DIR } from './wasmArtifact.js';
import {
    MAX_DICE,
    STRIDE,
    HEADER_INTS,
    H_SEQNO,
    H_FRONT,
    H_COUNT,
    H_SETTLED,
    H_CMD_HEAD,
    H_CMD_TAIL,
    H_PAIR_CANDIDATES,
    H_SPHERE_TESTS,
    H_SAT_TESTS,
    H_CONTACTS,
    idsOffset,
    xfOffset,
    faceValuesOffset,
    CMD_RING_FLOATS,
    CMD_RING_OFFSET,
    MAX_DYNAMICS,
    DYN_STRIDE,
    DYN_HEADER_INTS,
    DYN_H_FRONT,
    DYN_H_COUNT,
    dynIdsOffset,
    dynXfOffset,
} from './workerLayout.js';
import { computeSeededThrowParams, applyThrowParams } from './seededThrowParams.js';
import { dispatchLinear, drainRing } from './workerCommands.js';
import type { DicePhysicsModule, EmbindPhysicsEngine } from './physicsTypes.js';

/** Convex-hull + face-table data shipped in `public/wasm/hulls.json`. */
interface HullFace {
    normal: [number, number, number];
    value: number;
}
interface HullData {
    vertices: [number, number, number][];
    faces?: HullFace[];
}
type HullTable = Record<string, HullData | undefined>;

/** Payload of every message the main-thread proxy sends us. */
type CommandPayload = Record<string, any>;

const FIXED_DT = 1 / 120; // worker simulates at 120 Hz
const STEP_MS = 1000 * FIXED_DT;

let Module: DicePhysicsModule | null = null;
let engine: EmbindPhysicsEngine | null = null;
let hulls: HullTable | null = null;

// SAB transport state (null when running in postMessage-snapshot fallback).
let header: Int32Array | null = null; // Int32Array view over the header
const idsView: (Float32Array | null)[] = [null, null]; // Float32Array per buffer
const xfView: (Float32Array | null)[] = [null, null];
const faceValuesView: (Int32Array | null)[] = [null, null];
let cmdRing: Float32Array | null = null; // Float32Array command ring (SAB path)

// Dynamics SAB transport state (separate SharedArrayBuffer; null in fallback).
let dynHeader: Int32Array | null = null;
const dynIdsView: (Float32Array | null)[] = [null, null];
const dynXfView: (Float32Array | null)[] = [null, null];

let running = false; // true once init() has configured the world
let stepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Narrow the module/engine globals for the command handlers, which only ever
 * run after `boot()` + `ensureEngine()`. Throwing here surfaces as an `error`
 * message rather than an unhandled rejection in the worker.
 */
function requireModule(): DicePhysicsModule {
    if (!Module) throw new Error('WASM module not booted');
    return Module;
}
function requireEngine(): EmbindPhysicsEngine {
    if (!engine) throw new Error('engine not initialized');
    return engine;
}
function requireHeader(): Int32Array {
    if (!header) throw new Error('SAB header not attached');
    return header;
}

// ---------------------------------------------------------------------------
// Module bootstrap (top-level await — module workers support this)
// ---------------------------------------------------------------------------

async function boot() {
    // Dynamically import the Emscripten output from public/wasm/ (or
    // public/wasm-scalar/) at runtime. The Vite-busting import lives in
    // wasmArtifact.js so SIMD vs scalar selection stays in one place.
    const preferredDir =
        self.name === WASM_SCALAR_DIR || self.name === WASM_SIMD_DIR ? self.name : undefined;
    const loaded = await instantiateDicePhysicsModule({ preferredDir });
    Module = loaded.Module as DicePhysicsModule;

    try {
        const res = await fetch(publicAssetUrl('wasm/hulls.json'));
        if (res.ok) hulls = (await res.json()) as HullTable;
    } catch (_e) {
        // Hulls are optional; collision quality degrades but sim still runs.
    }
}

function ensureEngine(): void {
    if (engine) return;
    engine = new (requireModule().DicePhysicsEngine)();
}

// ---------------------------------------------------------------------------
// Frame publication
// ---------------------------------------------------------------------------

function attachHull(id: number, sides: number): void {
    if (id < 0 || !hulls) return;
    const data = hulls['d' + sides];
    if (!data || !data.vertices) return;
    const vec = new (requireModule().VectorFloat)();
    for (let i = 0; i < data.vertices.length; i++) {
        vec.push_back(data.vertices[i][0]);
        vec.push_back(data.vertices[i][1]);
        vec.push_back(data.vertices[i][2]);
    }
    requireEngine().setDieHull(id, vec);
    vec.delete?.();
    attachFaceTable(id, sides);
}

function attachFaceTable(id: number, sides: number): void {
    const eng = requireEngine();
    if (id < 0 || !hulls || typeof eng.setDieFaceTable !== 'function') return;
    const data = hulls['d' + sides];
    if (!data?.faces?.length) return;
    const vec = new (requireModule().VectorFloat)();
    for (const face of data.faces) {
        vec.push_back(face.normal[0]);
        vec.push_back(face.normal[1]);
        vec.push_back(face.normal[2]);
        vec.push_back(face.value);
    }
    eng.setDieFaceTable(id, vec);
    vec.delete?.();
}

function publishSAB(): void {
    // getDieIds()/getTransforms() are zero-copy views into the WASM heap; copy
    // their contents into the SAB back buffer (never alias/transfer the heap).
    const eng = requireEngine();
    const h = requireHeader();
    const ids = eng.getDieIds();
    const xf = eng.getTransforms();
    const faceValues = eng.getFaceValues();
    const count = Math.min(Math.floor(ids.length), MAX_DICE);

    const front = Number(Atomics.load(h, H_FRONT));
    const back = front ^ 1;

    const backIds = idsView[back];
    const backXf = xfView[back];
    const backFaceValues = faceValuesView[back];
    if (count > 0 && backIds && backXf && backFaceValues) {
        backIds.set(ids.subarray(0, count));
        backXf.set(xf.subarray(0, count * STRIDE));
        backFaceValues.set(faceValues.subarray(0, count));
    }

    // Store count *before* flipping front so a reader that sees the new front
    // is guaranteed to also see the matching count.
    Atomics.store(h, H_COUNT, count);
    Atomics.store(h, H_SETTLED, eng.areAllSettled() ? 1 : 0);
    const stepStats = eng.getLastStepStats();
    Atomics.store(h, H_PAIR_CANDIDATES, stepStats.pairCandidates | 0);
    Atomics.store(h, H_SPHERE_TESTS, stepStats.sphereTests | 0);
    Atomics.store(h, H_SAT_TESTS, stepStats.satTests | 0);
    Atomics.store(h, H_CONTACTS, stepStats.contacts | 0);
    Atomics.store(h, H_FRONT, back);
    Atomics.add(h, H_SEQNO, 1);
}

function publishSnapshot(): void {
    // Fallback path: copy out of the heap into fresh buffers, then transfer the
    // fresh (non-heap) buffers to avoid a second copy on the structured clone.
    const eng = requireEngine();
    const srcIds = eng.getDieIds();
    const srcXf = eng.getTransforms();
    const srcFaceValues = eng.getFaceValues();
    const count = Math.floor(srcIds.length);
    const ids = new Float32Array(count);
    const transforms = new Float32Array(count * STRIDE);
    const faceValues = new Int32Array(count);
    ids.set(srcIds.subarray(0, count));
    transforms.set(srcXf.subarray(0, count * STRIDE));
    faceValues.set(srcFaceValues.subarray(0, count));
    self.postMessage(
        {
            type: 'snapshot',
            payload: { ids, transforms, faceValues, count, settled: eng.areAllSettled() },
        },
        [ids.buffer, transforms.buffer, faceValues.buffer]
    );
}

function publishDynamicsSAB(): void {
    const eng = requireEngine();
    if (!dynHeader) return;
    const ids = eng.getDynamicIds();
    const xf = eng.getDynamicTransforms();
    const count = Math.min(Math.floor(ids.length), MAX_DYNAMICS);

    const front = Number(Atomics.load(dynHeader, DYN_H_FRONT));
    const back = front ^ 1;

    const backIds = dynIdsView[back];
    const backXf = dynXfView[back];
    if (count > 0 && backIds && backXf) {
        backIds.set(ids.subarray(0, count));
        backXf.set(xf.subarray(0, count * DYN_STRIDE));
    }

    // Same count-before-front ordering as publishSAB() above.
    Atomics.store(dynHeader, DYN_H_COUNT, count);
    Atomics.store(dynHeader, DYN_H_FRONT, back);
}

function publishDynamicsSnapshot(): void {
    const eng = requireEngine();
    const srcIds = eng.getDynamicIds();
    const srcXf = eng.getDynamicTransforms();
    const count = Math.floor(srcIds.length);
    const ids = new Float32Array(count);
    const transforms = new Float32Array(count * DYN_STRIDE);
    ids.set(srcIds.subarray(0, count));
    transforms.set(srcXf.subarray(0, count * DYN_STRIDE));
    self.postMessage({ type: 'dynamicsSnapshot', payload: { ids, transforms, count } }, [
        ids.buffer,
        transforms.buffer,
    ]);
}

function publishDynamics(): void {
    if (dynHeader) publishDynamicsSAB();
    else publishDynamicsSnapshot();
}

function publish(): void {
    if (header) publishSAB();
    else publishSnapshot();
    publishDynamics();
}

function drainEvents(): void {
    const ev = requireEngine().getCollisionEvents();
    if (!ev || ev.length === 0) return;
    const copy = new Float32Array(ev); // copy out of the heap before transfer
    self.postMessage({ type: 'events', payload: { events: copy } }, [copy.buffer]);
}

function drainCommandQueue(): void {
    if (cmdRing && header && engine) {
        const head = Number(Atomics.load(header, H_CMD_HEAD));
        let tail = Number(Atomics.load(header, H_CMD_TAIL));
        if (tail !== head) {
            tail = drainRing(engine, cmdRing, head, tail, CMD_RING_FLOATS);
            Atomics.store(header, H_CMD_TAIL, tail);
        }
    }
}

// ---------------------------------------------------------------------------
// Self-paced simulation loop
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message || String(err) : String(err);
}

function tick(): void {
    const eng = engine;
    if (!running || !eng) return;
    try {
        drainCommandQueue();
        if (eng.getDieCount() > 0) {
            eng.step(FIXED_DT);
        }
        drainEvents();
        publish();
    } catch (err) {
        self.postMessage({ type: 'error', payload: { message: errorMessage(err) } });
    }
}

function startLoop(): void {
    if (stepTimer !== null) return;
    stepTimer = setInterval(tick, STEP_MS);
}

function _stopLoop(): void {
    if (stepTimer !== null) {
        clearInterval(stepTimer);
        stepTimer = null;
    }
}

// ---------------------------------------------------------------------------
// Command handling
// ---------------------------------------------------------------------------

function handleInit(payload: CommandPayload): void {
    ensureEngine();
    const eng = requireEngine();
    eng.setFlags(payload.flags >>> 0);
    eng.init(payload.gravity, payload.tableY, payload.tableHalfW, payload.tableHalfD);
    if (payload.sab) {
        header = new Int32Array(payload.sab, 0, HEADER_INTS);
        for (const b of [0, 1] as const) {
            idsView[b] = new Float32Array(payload.sab, idsOffset(b), MAX_DICE);
            xfView[b] = new Float32Array(payload.sab, xfOffset(b), MAX_DICE * STRIDE);
            faceValuesView[b] = new Int32Array(payload.sab, faceValuesOffset(b), MAX_DICE);
        }
        cmdRing = new Float32Array(payload.sab, CMD_RING_OFFSET, CMD_RING_FLOATS);
        Atomics.store(header, H_CMD_HEAD, 0);
        Atomics.store(header, H_CMD_TAIL, 0);
    }
    if (payload.sabDynamics) {
        dynHeader = new Int32Array(payload.sabDynamics, 0, DYN_HEADER_INTS);
        for (const b of [0, 1] as const) {
            dynIdsView[b] = new Float32Array(payload.sabDynamics, dynIdsOffset(b), MAX_DYNAMICS);
            dynXfView[b] = new Float32Array(
                payload.sabDynamics,
                dynXfOffset(b),
                MAX_DYNAMICS * DYN_STRIDE
            );
        }
    }
    running = true;
    publish();
    startLoop();
}

function handle(type: string, payload: CommandPayload): void {
    // Every command except init operates on the engine, which is created during
    // init. Ignore stray pre-init commands rather than throwing.
    if (type === 'init') {
        handleInit(payload);
        return;
    }
    const eng = engine;
    if (!eng) return;
    switch (type) {
        case 'batch':
            drainCommandQueue();
            if (payload?.commands?.length) {
                dispatchLinear(eng, payload.commands);
            }
            break;
        case 'reset':
            drainCommandQueue();
            eng.reset();
            if (header) {
                Atomics.store(header, H_CMD_HEAD, 0);
                Atomics.store(header, H_CMD_TAIL, 0);
            }
            publish();
            break;
        case 'addDie': {
            drainCommandQueue();
            const id = eng.addDie(payload.sides, payload.x, payload.y, payload.z);
            attachHull(id, payload.sides);
            // Report the actual id so the proxy can assert its mirrored counter
            // stayed in sync with the engine's monotonic allocator.
            self.postMessage({ type: 'dieAdded', payload: { expectedId: payload.expectedId, id } });
            publish();
            break;
        }
        case 'removeDie':
            drainCommandQueue();
            eng.removeDie(payload.id);
            publish();
            break;
        case 'clearAllDice':
            drainCommandQueue();
            eng.clearAllDice();
            publish();
            break;
        case 'setDieHull':
            drainCommandQueue();
            attachHull(payload.id, payload.sides);
            break;
        case 'setDieMaterial':
            drainCommandQueue();
            eng.setDieMaterial(payload.id, payload.friction, payload.rollingFriction);
            break;
        case 'setDieDrag':
            drainCommandQueue();
            eng.setDieDrag(payload.id, payload.drag);
            break;
        case 'setDieTransform':
            drainCommandQueue();
            eng.setDieTransform(
                payload.id,
                payload.px,
                payload.py,
                payload.pz,
                payload.qx,
                payload.qy,
                payload.qz,
                payload.qw
            );
            break;
        case 'setDieVelocity':
            drainCommandQueue();
            eng.setDieVelocity(
                payload.id,
                payload.lvx,
                payload.lvy,
                payload.lvz,
                payload.avx,
                payload.avy,
                payload.avz
            );
            break;
        case 'setDieKinematic':
            eng.setDieKinematic(payload.id, payload.kinematic);
            break;
        case 'setContainerActive':
            eng.setContainerActive(!!payload.active);
            break;
        case 'setContainerPlanes': {
            const vec = new (requireModule().VectorFloat)();
            for (const f of payload.planes) vec.push_back(f);
            eng.setContainerPlanes(vec);
            vec.delete?.();
            break;
        }
        case 'clearStatics':
            eng.clearStatics();
            break;
        case 'removeStatic':
            eng.removeStatic(payload.userId);
            break;
        case 'addStaticBox':
            eng.addStaticBox(
                payload.userId,
                payload.cx,
                payload.cy,
                payload.cz,
                payload.hx,
                payload.hy,
                payload.hz,
                payload.qx,
                payload.qy,
                payload.qz,
                payload.qw,
                payload.materialTag ?? 0
            );
            break;
        case 'addStaticPlane':
            eng.addStaticPlane(
                payload.userId,
                payload.nx,
                payload.ny,
                payload.nz,
                payload.dist,
                payload.materialTag ?? 0
            );
            break;
        case 'addStaticConvexHull': {
            const vec = new (requireModule().VectorFloat)();
            for (const f of payload.vertices) vec.push_back(f);
            eng.addStaticConvexHull(
                payload.userId,
                payload.cx,
                payload.cy,
                payload.cz,
                payload.qx,
                payload.qy,
                payload.qz,
                payload.qw,
                vec,
                payload.materialTag ?? 0
            );
            vec.delete?.();
            break;
        }
        case 'addStaticOpenCylinder':
            eng.addStaticOpenCylinder(
                payload.userId,
                payload.cx,
                payload.cy,
                payload.cz,
                payload.radius,
                payload.halfHeight,
                payload.segments ?? 16,
                !!payload.closedBottom,
                payload.materialTag ?? 0
            );
            break;
        case 'clearDynamics':
            drainCommandQueue();
            eng.clearDynamics();
            publish();
            break;
        case 'removeDynamic':
            drainCommandQueue();
            eng.removeDynamic(payload.userId);
            publish();
            break;
        case 'setDynamicKinematic':
            drainCommandQueue();
            eng.setDynamicKinematic(payload.userId, payload.kinematic);
            break;
        case 'addDynamicBox':
            drainCommandQueue();
            eng.addDynamicBox(
                payload.userId,
                payload.mass,
                payload.cx,
                payload.cy,
                payload.cz,
                payload.hx,
                payload.hy,
                payload.hz,
                payload.qx,
                payload.qy,
                payload.qz,
                payload.qw,
                payload.materialTag ?? 0
            );
            publish();
            break;
        case 'addDynamicHull': {
            drainCommandQueue();
            const vec = new (requireModule().VectorFloat)();
            for (const f of payload.vertices) vec.push_back(f);
            eng.addDynamicHull(
                payload.userId,
                payload.mass,
                payload.cx,
                payload.cy,
                payload.cz,
                payload.qx,
                payload.qy,
                payload.qz,
                payload.qw,
                vec,
                payload.materialTag ?? 0
            );
            vec.delete?.();
            publish();
            break;
        }
        case 'applyImpulse':
            drainCommandQueue();
            eng.applyImpulse(payload.id, payload.fx, payload.fy, payload.fz);
            break;
        case 'applyTorqueImpulse':
            drainCommandQueue();
            eng.applyTorqueImpulse(payload.id, payload.tx, payload.ty, payload.tz);
            break;
        case 'seedRNG':
            drainCommandQueue();
            eng.seedRNG(payload.seed);
            break;
        case 'serializeState': {
            const vec = eng.serializeState();
            const arr = new Uint8Array(vec.size());
            for (let i = 0; i < vec.size(); i++) arr[i] = vec.get(i);
            vec.delete?.();
            self.postMessage(
                {
                    type: 'response',
                    payload: { reqId: payload.reqId, byteLength: arr.byteLength, data: arr.buffer },
                },
                [arr.buffer]
            );
            break;
        }
        case 'seededThrow': {
            eng.seedRNG(payload.seed >>> 0);
            const params = computeSeededThrowParams(
                () => eng.randomFloat(),
                payload.dice,
                payload.tableSurfaceY
            );
            applyThrowParams(eng, params);
            publish();
            break;
        }
        case 'deserializeState': {
            drainCommandQueue();
            const vec = new (requireModule().VectorU8)();
            for (const b of payload.data) vec.push_back(b);
            eng.deserializeState(vec);
            vec.delete?.();
            publish();
            break;
        }
        default:
            self.postMessage({ type: 'error', payload: { message: 'Unknown command: ' + type } });
    }
}

// Buffer commands that arrive before the engine finishes booting.
interface WorkerCommandMessage {
    type: string;
    payload: CommandPayload;
}

const pending: WorkerCommandMessage[] = [];
let booted = false;

self.onmessage = (e: MessageEvent<WorkerCommandMessage>) => {
    if (!booted) {
        pending.push(e.data);
        return;
    }
    const { type, payload } = e.data;
    try {
        handle(type, payload);
    } catch (err) {
        self.postMessage({ type: 'error', payload: { message: errorMessage(err) } });
    }
};

boot()
    .then(() => {
        booted = true;
        for (const msg of pending) {
            try {
                handle(msg.type, msg.payload);
            } catch (err) {
                self.postMessage({
                    type: 'error',
                    payload: { message: errorMessage(err) },
                });
            }
        }
        pending.length = 0;
        self.postMessage({ type: 'ready' });
    })
    .catch((err) => {
        self.postMessage({
            type: 'error',
            payload: { message: 'boot failed: ' + errorMessage(err) },
        });
    });
