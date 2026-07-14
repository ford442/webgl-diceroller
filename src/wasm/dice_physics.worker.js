/**
 * dice_physics.worker.js
 *
 * Production physics Web Worker (Phase 4).  Hosts the custom WASM dice-physics
 * engine entirely off the main thread, self-paces a fixed-timestep simulation,
 * and publishes rigid-body transforms to the main thread.
 *
 * Transport:
 *   • Preferred: a double-buffered SharedArrayBuffer (see workerLayout.js).  The
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
import {
    MAX_DICE, STRIDE, HEADER_INTS, H_SEQNO, H_FRONT, H_COUNT, H_SETTLED,
    H_CMD_HEAD, H_CMD_TAIL,
    idsOffset, xfOffset, CMD_RING_FLOATS, CMD_RING_OFFSET,
} from './workerLayout.js';
import { computeSeededThrowParams, applyThrowParams } from './seededThrowParams.js';
import { dispatchLinear, drainRing } from './workerCommands.js';

const FIXED_DT = 1 / 120;          // worker simulates at 120 Hz
const STEP_MS = 1000 * FIXED_DT;

let Module = null;
let engine = null;
let hulls = null;

// SAB transport state (null when running in postMessage-snapshot fallback).
let header = null;                 // Int32Array view over the header
const idsView = [null, null];      // Float32Array per buffer
const xfView = [null, null];
let cmdRing = null;                // Float32Array command ring (SAB path)

let running = false;               // true once init() has configured the world
let stepTimer = null;

// ---------------------------------------------------------------------------
// Module bootstrap (top-level await — module workers support this)
// ---------------------------------------------------------------------------

async function boot() {
    // Dynamically import the Emscripten output from public/wasm/ at runtime.
    // Using a constructed import avoids Vite trying to bundle the prebuilt artifact.
    const dynamicImport = new Function('u', 'return import(u)');
    const factoryMod = await dynamicImport(publicAssetUrl('wasm/dice_physics.js'));
    const Factory = factoryMod.default || factoryMod;
    Module = await Factory();

    try {
        const res = await fetch(publicAssetUrl('wasm/hulls.json'));
        if (res.ok) hulls = await res.json();
    } catch (e) {
        // Hulls are optional; collision quality degrades but sim still runs.
    }
}

function ensureEngine() {
    if (engine) return;
    engine = new Module.DicePhysicsEngine();
}

// ---------------------------------------------------------------------------
// Frame publication
// ---------------------------------------------------------------------------

function attachHull(id, sides) {
    if (id < 0 || !hulls) return;
    const data = hulls['d' + sides];
    if (!data || !data.vertices) return;
    const vec = new Module.VectorFloat();
    for (let i = 0; i < data.vertices.length; i++) {
        vec.push_back(data.vertices[i][0]);
        vec.push_back(data.vertices[i][1]);
        vec.push_back(data.vertices[i][2]);
    }
    engine.setDieHull(id, vec);
    if (typeof vec.delete === 'function') vec.delete();
}

function publishSAB() {
    // getDieIds()/getTransforms() are zero-copy views into the WASM heap; copy
    // their contents into the SAB back buffer (never alias/transfer the heap).
    const ids = engine.getDieIds();
    const xf = engine.getTransforms();
    const count = Math.min(Math.floor(ids.length), MAX_DICE);

    const front = Number(Atomics.load(header, H_FRONT));
    const back = front ^ 1;

    if (count > 0) {
        idsView[back].set(ids.subarray(0, count));
        xfView[back].set(xf.subarray(0, count * STRIDE));
    }

    // Store count *before* flipping front so a reader that sees the new front
    // is guaranteed to also see the matching count.
    Atomics.store(header, H_COUNT, count);
    Atomics.store(header, H_SETTLED, engine.areAllSettled() ? 1 : 0);
    Atomics.store(header, H_FRONT, back);
    Atomics.add(header, H_SEQNO, 1);
}

function publishSnapshot() {
    // Fallback path: copy out of the heap into fresh buffers, then transfer the
    // fresh (non-heap) buffers to avoid a second copy on the structured clone.
    const srcIds = engine.getDieIds();
    const srcXf = engine.getTransforms();
    const count = Math.floor(srcIds.length);
    const ids = new Float32Array(count);
    const transforms = new Float32Array(count * STRIDE);
    ids.set(srcIds.subarray(0, count));
    transforms.set(srcXf.subarray(0, count * STRIDE));
    self.postMessage(
        {
            type: 'snapshot',
            payload: { ids, transforms, count, settled: engine.areAllSettled() },
        },
        [ids.buffer, transforms.buffer]
    );
}

function publish() {
    if (header) publishSAB();
    else publishSnapshot();
}

function drainEvents() {
    const ev = engine.getCollisionEvents();
    if (!ev || ev.length === 0) return;
    const copy = new Float32Array(ev);   // copy out of the heap before transfer
    self.postMessage({ type: 'events', payload: { events: copy } }, [copy.buffer]);
}

function drainCommandQueue() {
    if (cmdRing && header) {
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

function tick() {
    if (!running || !engine) return;
    try {
        drainCommandQueue();
        if (engine.getDieCount() > 0) {
            engine.step(FIXED_DT);
        }
        drainEvents();
        publish();
    } catch (err) {
        self.postMessage({ type: 'error', payload: { message: err.message || String(err) } });
    }
}

function startLoop() {
    if (stepTimer !== null) return;
    stepTimer = setInterval(tick, STEP_MS);
}

function stopLoop() {
    if (stepTimer !== null) {
        clearInterval(stepTimer);
        stepTimer = null;
    }
}

// ---------------------------------------------------------------------------
// Command handling
// ---------------------------------------------------------------------------

function handle(type, payload) {
    // Every command except init operates on the engine, which is created during
    // init. Ignore stray pre-init commands rather than throwing.
    if (type !== 'init' && !engine) return;
    switch (type) {
        case 'batch':
            drainCommandQueue();
            if (payload?.commands?.length) {
                dispatchLinear(engine, payload.commands);
            }
            break;
        case 'init': {
            ensureEngine();
            engine.setFlags(payload.flags >>> 0);
            engine.init(payload.gravity, payload.tableY, payload.tableHalfW, payload.tableHalfD);
            if (payload.sab) {
                header = new Int32Array(payload.sab, 0, HEADER_INTS);
                for (let b = 0; b < 2; b++) {
                    idsView[b] = new Float32Array(payload.sab, idsOffset(b), MAX_DICE);
                    xfView[b] = new Float32Array(payload.sab, xfOffset(b), MAX_DICE * STRIDE);
                }
                cmdRing = new Float32Array(payload.sab, CMD_RING_OFFSET, CMD_RING_FLOATS);
                Atomics.store(header, H_CMD_HEAD, 0);
                Atomics.store(header, H_CMD_TAIL, 0);
            }
            running = true;
            publish();
            startLoop();
            break;
        }
        case 'reset':
            drainCommandQueue();
            engine.reset();
            if (header) {
                Atomics.store(header, H_CMD_HEAD, 0);
                Atomics.store(header, H_CMD_TAIL, 0);
            }
            publish();
            break;
        case 'addDie': {
            drainCommandQueue();
            const id = engine.addDie(payload.sides, payload.x, payload.y, payload.z);
            attachHull(id, payload.sides);
            // Report the actual id so the proxy can assert its mirrored counter
            // stayed in sync with the engine's monotonic allocator.
            self.postMessage({ type: 'dieAdded', payload: { expectedId: payload.expectedId, id } });
            publish();
            break;
        }
        case 'removeDie':
            drainCommandQueue();
            engine.removeDie(payload.id);
            publish();
            break;
        case 'clearAllDice':
            drainCommandQueue();
            engine.clearAllDice();
            publish();
            break;
        case 'setDieHull':
            drainCommandQueue();
            attachHull(payload.id, payload.sides);
            break;
        case 'setDieMaterial':
            drainCommandQueue();
            engine.setDieMaterial(payload.id, payload.friction, payload.rollingFriction);
            break;
        case 'setDieDrag':
            drainCommandQueue();
            engine.setDieDrag(payload.id, payload.drag);
            break;
        case 'setDieTransform':
            drainCommandQueue();
            engine.setDieTransform(payload.id, payload.px, payload.py, payload.pz, payload.qx, payload.qy, payload.qz, payload.qw);
            break;
        case 'setDieVelocity':
            drainCommandQueue();
            engine.setDieVelocity(payload.id, payload.lvx, payload.lvy, payload.lvz, payload.avx, payload.avy, payload.avz);
            break;
        case 'setDieKinematic':
            engine.setDieKinematic(payload.id, payload.kinematic);
            break;
        case 'applyImpulse':
            drainCommandQueue();
            engine.applyImpulse(payload.id, payload.fx, payload.fy, payload.fz);
            break;
        case 'applyTorqueImpulse':
            drainCommandQueue();
            engine.applyTorqueImpulse(payload.id, payload.tx, payload.ty, payload.tz);
            break;
        case 'seedRNG':
            drainCommandQueue();
            engine.seedRNG(payload.seed);
            break;
        case 'serializeState': {
            const vec = engine.serializeState();
            const arr = new Uint8Array(vec.size());
            for (let i = 0; i < vec.size(); i++) arr[i] = vec.get(i);
            if (typeof vec.delete === 'function') vec.delete();
            self.postMessage(
                { type: 'response', payload: { reqId: payload.reqId, byteLength: arr.byteLength, data: arr.buffer } },
                [arr.buffer]
            );
            break;
        }
        case 'seededThrow': {
            engine.seedRNG(payload.seed >>> 0);
            const params = computeSeededThrowParams(
                () => engine.randomFloat(),
                payload.dice,
                payload.tableSurfaceY
            );
            applyThrowParams(engine, params);
            publish();
            break;
        }
        case 'deserializeState': {
            drainCommandQueue();
            const vec = new Module.VectorU8();
            for (const b of payload.data) vec.push_back(b);
            engine.deserializeState(vec);
            if (typeof vec.delete === 'function') vec.delete();
            publish();
            break;
        }
        default:
            self.postMessage({ type: 'error', payload: { message: 'Unknown command: ' + type } });
    }
}

// Buffer commands that arrive before the engine finishes booting.
const pending = [];
let booted = false;

self.onmessage = (e) => {
    if (!booted) { pending.push(e.data); return; }
    const { type, payload } = e.data;
    try {
        handle(type, payload);
    } catch (err) {
        self.postMessage({ type: 'error', payload: { message: err.message || String(err) } });
    }
};

boot().then(() => {
    booted = true;
    for (const msg of pending) {
        try {
            handle(msg.type, msg.payload);
        } catch (err) {
            self.postMessage({ type: 'error', payload: { message: err.message || String(err) } });
        }
    }
    pending.length = 0;
    self.postMessage({ type: 'ready' });
}).catch((err) => {
    self.postMessage({ type: 'error', payload: { message: 'boot failed: ' + (err.message || String(err)) } });
});
