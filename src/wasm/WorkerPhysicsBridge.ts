/**
 * WorkerPhysicsBridge.ts
 *
 * Production worker-backed physics bridge (Phase 4).  Exposes the *exact same*
 * synchronous API as WasmPhysicsBridge.js so it is a drop-in replacement —
 * `dice.js` / `main.js` cannot tell which bridge they are talking to.
 *
 * High-frequency commands (torque, transforms, velocities, impulses) are
 * accumulated into a per-frame scratch buffer and flushed once per frame —
 * either into a SharedArrayBuffer command ring (zero postMessages) or via a
 * single `batch` postMessage when SAB is unavailable.
 *
 * Structural commands (init, addDie, removeDie, …) stay on plain postMessage.
 */

import {
    MAX_DICE,
    STRIDE,
    HEADER_INTS,
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
    SAB_BYTES,
    CMD_RING_FLOATS,
    CMD_RING_OFFSET,
    sabSupported,
    MAX_DYNAMICS,
    DYN_STRIDE,
    DYN_HEADER_INTS,
    DYN_H_FRONT,
    DYN_H_COUNT,
    dynIdsOffset,
    dynXfOffset,
    DYNAMICS_SAB_BYTES,
} from './workerLayout.js';
import { parsePhysicsFlags } from './physicsFlags.js';
import { resolveWasmArtifactDir } from './wasmArtifact.js';
import { OP, copyIntoRing, countRecords } from './workerCommands.js';
import { parseCollisionEventBuffer } from './collisionEvents.js';
import type { CollisionEvent, PhysicsEngine } from './physicsTypes.js';
import type { SeededDieRef } from './seededThrowParams.js';

interface StepStats {
    pairCandidates: number;
    sphereTests: number;
    satTests: number;
    contacts: number;
}

/** Resolver state for an in-flight `_request()`. */
interface PendingRequest {
    resolve: (value: ResponsePayload) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface ResponsePayload {
    reqId: number;
    error?: string;
    data: ArrayBuffer;
    byteLength: number;
}

type CommandPayload = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Debug / perf counters (surfaced via getWorkerPhysicsStats)
// ---------------------------------------------------------------------------

const _stats: {
    structuralMsgs: number;
    batchMsgs: number;
    batchRecords: number;
    lastSampleAt: number;
    msgsPerSecond: number;
} = {
    structuralMsgs: 0,
    batchMsgs: 0,
    batchRecords: 0,
    lastSampleAt: typeof performance !== 'undefined' ? performance.now() : 0,
    msgsPerSecond: 0,
};

function _noteStructuralMsg(): void {
    _stats.structuralMsgs++;
}

function _noteBatchMsg(recordCount: number): void {
    _stats.batchMsgs++;
    _stats.batchRecords += recordCount;
}

export function getWorkerPhysicsStats() {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = (now - _stats.lastSampleAt) / 1000;
    if (dt >= 0.2) {
        _stats.msgsPerSecond = dt > 0 ? (_stats.structuralMsgs + _stats.batchMsgs) / dt : 0;
        _stats.structuralMsgs = 0;
        _stats.batchMsgs = 0;
        _stats.batchRecords = 0;
        _stats.lastSampleAt = now;
    }
    let stepStats: StepStats | null = null;
    if (_usingSAB && _engine?.header) {
        const h = _engine.header;
        stepStats = {
            pairCandidates: Atomics.load(h, H_PAIR_CANDIDATES),
            sphereTests: Atomics.load(h, H_SPHERE_TESTS),
            satTests: Atomics.load(h, H_SAT_TESTS),
            contacts: Atomics.load(h, H_CONTACTS),
        };
    }
    return {
        usingCommandBatch: true,
        usingSAB: _usingSAB,
        msgsPerSecond: _stats.msgsPerSecond,
        batchRecords: _stats.batchRecords,
        stepStats,
    };
}

/** Last-step broadphase / collision counters (worker SAB header or main-thread engine). */
export function getPhysicsStepStats(): StepStats | null {
    if (_usingSAB && _engine?.header) {
        const h = _engine.header;
        return {
            pairCandidates: Atomics.load(h, H_PAIR_CANDIDATES),
            sphereTests: Atomics.load(h, H_SPHERE_TESTS),
            satTests: Atomics.load(h, H_SAT_TESTS),
            contacts: Atomics.load(h, H_CONTACTS),
        };
    }
    return null;
}

const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Synchronous proxy mimicking DicePhysicsEngine
// ---------------------------------------------------------------------------

class WorkerEngineProxy implements PhysicsEngine {
    header: Int32Array | null = null;
    idsView: [Float32Array, Float32Array] | null = null;
    xfView: [Float32Array, Float32Array] | null = null;
    faceValuesView: [Int32Array, Int32Array] | null = null;
    cmdRing: Float32Array | null = null;

    dynHeader: Int32Array | null = null;
    dynIdsView: [Float32Array, Float32Array] | null = null;
    dynXfView: [Float32Array, Float32Array] | null = null;

    readonly worker: Worker;
    readonly sab: SharedArrayBuffer | null;
    readonly sabDynamics: SharedArrayBuffer | null;

    private _nextId = 0;
    private _count = 0;
    private _cmdHead = 0;
    private _scratch = new Float32Array(1024);
    private _scratchLen = 0;

    private _snapIds = new Float32Array(0);
    private _snapXf = new Float32Array(0);
    private _snapFaceValues = new Int32Array(0);
    private _snapCount = 0;
    private _snapSettled = true;
    private _eventChunks: Float32Array[] = [];

    private _dynSnapIds = new Float32Array(0);
    private _dynSnapXf = new Float32Array(0);
    private _dynSnapCount = 0;

    private _pending = new Map<number, PendingRequest>();
    private _nextReqId = 1;

    constructor(
        worker: Worker,
        sab: SharedArrayBuffer | null,
        sabDynamics: SharedArrayBuffer | null = null
    ) {
        this.worker = worker;
        this.sab = sab;
        this.sabDynamics = sabDynamics;

        if (sab) {
            this.header = new Int32Array(sab, 0, HEADER_INTS);
            this.idsView = [
                new Float32Array(sab, idsOffset(0), MAX_DICE),
                new Float32Array(sab, idsOffset(1), MAX_DICE),
            ];
            this.xfView = [
                new Float32Array(sab, xfOffset(0), MAX_DICE * STRIDE),
                new Float32Array(sab, xfOffset(1), MAX_DICE * STRIDE),
            ];
            this.faceValuesView = [
                new Int32Array(sab, faceValuesOffset(0), MAX_DICE),
                new Int32Array(sab, faceValuesOffset(1), MAX_DICE),
            ];
            this.cmdRing = new Float32Array(sab, CMD_RING_OFFSET, CMD_RING_FLOATS);
            Atomics.store(this.header, H_CMD_HEAD, 0);
            Atomics.store(this.header, H_CMD_TAIL, 0);
        }

        if (sabDynamics) {
            this.dynHeader = new Int32Array(sabDynamics, 0, DYN_HEADER_INTS);
            this.dynIdsView = [
                new Float32Array(sabDynamics, dynIdsOffset(0), MAX_DYNAMICS),
                new Float32Array(sabDynamics, dynIdsOffset(1), MAX_DYNAMICS),
            ];
            this.dynXfView = [
                new Float32Array(sabDynamics, dynXfOffset(0), MAX_DYNAMICS * DYN_STRIDE),
                new Float32Array(sabDynamics, dynXfOffset(1), MAX_DYNAMICS * DYN_STRIDE),
            ];
        }

        worker.onmessage = (e: MessageEvent) => this._onMessage(e.data);
    }

    private _onMessage({ type, payload }: { type: string; payload: any }): void {
        if (type === 'response' && payload?.reqId != null) {
            const pending = this._pending.get(payload.reqId);
            if (pending) {
                this._pending.delete(payload.reqId);
                clearTimeout(pending.timer);
                if (payload.error) pending.reject(new Error(payload.error));
                else pending.resolve(payload);
            }
            return;
        }

        switch (type) {
            case 'snapshot':
                this._snapIds = payload.ids;
                this._snapXf = payload.transforms;
                this._snapFaceValues = payload.faceValues ?? new Int32Array(0);
                this._snapCount = payload.count;
                this._snapSettled = payload.settled;
                break;
            case 'events':
                this._eventChunks.push(payload.events);
                break;
            case 'dynamicsSnapshot':
                this._dynSnapIds = payload.ids;
                this._dynSnapXf = payload.transforms;
                this._dynSnapCount = payload.count;
                break;
            case 'dieAdded':
                if (payload.expectedId != null && payload.id !== payload.expectedId) {
                    console.warn(
                        `[WorkerPhysics] id mirror drift: expected ${payload.expectedId}, engine gave ${payload.id}`
                    );
                }
                break;
            case 'error':
                console.error('[WorkerPhysics]', payload.message);
                break;
        }
    }

    private _send(type: string, payload: CommandPayload = {}, transfer: Transferable[] = []): void {
        this.flushCommandBatch();
        _noteStructuralMsg();
        this.worker.postMessage({ type, payload }, transfer);
    }

    private _request(
        type: string,
        payload: CommandPayload = {},
        transfer: Transferable[] = []
    ): Promise<ResponsePayload> {
        const reqId = this._nextReqId++;
        return new Promise<ResponsePayload>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this._pending.has(reqId)) {
                    this._pending.delete(reqId);
                    reject(new Error(`[WorkerPhysics] request timeout: ${type}`));
                }
            }, REQUEST_TIMEOUT_MS);
            this._pending.set(reqId, { resolve, reject, timer });
            this._send(type, { ...payload, reqId }, transfer);
        });
    }

    private _ensureScratch(room: number): void {
        if (this._scratchLen + room <= this._scratch.length) return;
        const next = new Float32Array(Math.max(this._scratch.length * 2, this._scratchLen + room));
        next.set(this._scratch.subarray(0, this._scratchLen));
        this._scratch = next;
    }

    private _enqueue(
        opcode: number,
        id: number,
        a: number,
        b: number,
        c: number,
        d = 0,
        e = 0,
        f = 0,
        g = 0
    ): void {
        const len =
            opcode === OP.SET_TRANSFORM || opcode === OP.PROP_SET_TRANSFORM
                ? 9
                : opcode === OP.SET_VELOCITY || opcode === OP.PROP_SET_VELOCITY
                  ? 8
                  : 5;
        this._ensureScratch(len);
        const i = this._scratchLen;
        this._scratch[i] = opcode;
        this._scratch[i + 1] = id;
        this._scratch[i + 2] = a;
        this._scratch[i + 3] = b;
        this._scratch[i + 4] = c;
        if (len > 5) {
            this._scratch[i + 5] = d;
            this._scratch[i + 6] = e;
            this._scratch[i + 7] = f;
            if (len > 8) this._scratch[i + 8] = g;
        }
        this._scratchLen += len;
    }

    /** Flush accumulated per-frame commands to the worker (call once per frame). */
    flushCommandBatch(): void {
        if (this._scratchLen === 0) return;

        const batch = this._scratch.subarray(0, this._scratchLen);
        const records = countRecords(batch, 0, this._scratchLen);

        if (this.cmdRing && this.header) {
            const head = Atomics.load(this.header, H_CMD_HEAD);
            this._cmdHead = copyIntoRing(this.cmdRing, CMD_RING_FLOATS, head, batch);
            Atomics.store(this.header, H_CMD_HEAD, this._cmdHead);
        } else {
            const copy = batch.slice();
            _noteBatchMsg(records);
            this.worker.postMessage({ type: 'batch', payload: { commands: copy } }, [copy.buffer]);
        }

        this._scratchLen = 0;
    }

    // --- lifecycle ---------------------------------------------------------
    init(gravity: number, tableY: number, tableHalfW: number, tableHalfD: number): void {
        this._send('init', {
            gravity,
            tableY,
            tableHalfW,
            tableHalfD,
            flags: parsePhysicsFlags(_searchParams),
            sab: this.sab || null,
            sabDynamics: this.sabDynamics || null,
        });
    }

    reset(): void {
        this._scratchLen = 0;
        this._nextId = 0;
        this._count = 0;
        if (this.header) {
            Atomics.store(this.header, H_CMD_HEAD, 0);
            Atomics.store(this.header, H_CMD_TAIL, 0);
            this._cmdHead = 0;
        }
        this._send('reset');
    }

    // --- die management ----------------------------------------------------
    addDie(sides: number, x: number, y: number, z: number): number {
        if (this._count >= MAX_DICE) return -1;
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return -1;
        const id = this._nextId++;
        this._count++;
        this._send('addDie', { sides, x, y, z, expectedId: id });
        return id;
    }

    removeDie(id: number): void {
        if (this._count > 0) this._count--;
        this._send('removeDie', { id });
    }

    clearAllDice(): void {
        this._count = 0;
        this._send('clearAllDice');
    }

    setDieHull(id: number, sides: number): void {
        this._send('setDieHull', { id, sides });
    }
    setDieMaterial(id: number, friction: number, rollingFriction: number): void {
        this._send('setDieMaterial', { id, friction, rollingFriction });
    }
    setDieDrag(id: number, drag: number): void {
        this._send('setDieDrag', { id, drag });
    }

    // --- forces (batched) --------------------------------------------------
    applyImpulse(id: number, fx: number, fy: number, fz: number): void {
        this._enqueue(OP.APPLY_IMPULSE, id, fx, fy, fz);
    }
    applyTorqueImpulse(id: number, tx: number, ty: number, tz: number): void {
        this._enqueue(OP.APPLY_TORQUE, id, tx, ty, tz);
    }

    // --- state sync (batched) ----------------------------------------------
    setDieTransform(
        id: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void {
        this._enqueue(OP.SET_TRANSFORM, id, px, py, pz, qx, qy, qz, qw);
    }
    setDieVelocity(
        id: number,
        lvx: number,
        lvy: number,
        lvz: number,
        avx: number,
        avy: number,
        avz: number
    ): void {
        this._enqueue(OP.SET_VELOCITY, id, lvx, lvy, lvz, avx, avy, avz);
    }
    setDieKinematic(id: number, kinematic: boolean): void {
        this._send('setDieKinematic', { id, kinematic });
    }

    setContainerActive(active: boolean): void {
        this._send('setContainerActive', { active: !!active });
    }

    setContainerPlanes(planes: Float32Array | number[]): void {
        this._send('setContainerPlanes', { planes: Array.from(planes) });
    }

    clearStatics(): void {
        this._send('clearStatics');
    }

    // Structural static-collider commands are fire-and-forget postMessages —
    // the worker can't report success/id synchronously, so these return the
    // same "unknown" sentinel the interface uses for a failed synchronous call
    // (`false` / `-1`) rather than claim a result we don't have.
    removeStatic(userId: number): boolean {
        this._send('removeStatic', { userId });
        return false;
    }

    addStaticBox(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        materialTag: number
    ): number {
        this._send('addStaticBox', {
            userId,
            cx,
            cy,
            cz,
            hx,
            hy,
            hz,
            qx,
            qy,
            qz,
            qw,
            materialTag,
        });
        return -1;
    }

    addStaticPlane(
        userId: number,
        nx: number,
        ny: number,
        nz: number,
        dist: number,
        materialTag: number
    ): number {
        this._send('addStaticPlane', { userId, nx, ny, nz, dist, materialTag });
        return -1;
    }

    addStaticConvexHull(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        flatVerts: number[] | Float32Array,
        materialTag: number
    ): number {
        this._send('addStaticConvexHull', {
            userId,
            cx,
            cy,
            cz,
            qx,
            qy,
            qz,
            qw,
            vertices: Array.from(flatVerts),
            materialTag,
        });
        return -1;
    }

    addStaticOpenCylinder(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        radius: number,
        halfHeight: number,
        segments: number,
        closedBottom: boolean,
        materialTag: number
    ): number {
        this._send('addStaticOpenCylinder', {
            userId,
            cx,
            cy,
            cz,
            radius,
            halfHeight,
            segments,
            closedBottom: !!closedBottom,
            materialTag,
        });
        return -1;
    }

    // --- dynamic (non-die) rigid-body props ---------------------------------
    clearDynamics(): void {
        this._send('clearDynamics');
    }

    // Fire-and-forget, like the static-collider commands above: userId is
    // caller-supplied, so there's no synchronous id to hand back.
    removeDynamic(userId: number): boolean {
        this._send('removeDynamic', { userId });
        return false;
    }

    setDynamicKinematic(userId: number, kinematic: boolean): void {
        this._send('setDynamicKinematic', { userId, kinematic: !!kinematic });
    }

    addDynamicBox(
        userId: number,
        mass: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        materialTag: number
    ): number {
        this._send('addDynamicBox', {
            userId,
            mass,
            cx,
            cy,
            cz,
            hx,
            hy,
            hz,
            qx,
            qy,
            qz,
            qw,
            materialTag,
        });
        return -1;
    }

    addDynamicHull(
        userId: number,
        mass: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        flatVerts: number[] | Float32Array,
        materialTag: number
    ): number {
        this._send('addDynamicHull', {
            userId,
            mass,
            cx,
            cy,
            cz,
            qx,
            qy,
            qz,
            qw,
            vertices: Array.from(flatVerts),
            materialTag,
        });
        return -1;
    }

    // --- dynamic prop forces / state sync (batched) -------------------------
    applyDynamicImpulse(userId: number, fx: number, fy: number, fz: number): void {
        this._enqueue(OP.PROP_APPLY_IMPULSE, userId, fx, fy, fz);
    }
    applyDynamicTorqueImpulse(userId: number, tx: number, ty: number, tz: number): void {
        this._enqueue(OP.PROP_APPLY_TORQUE, userId, tx, ty, tz);
    }
    setDynamicTransform(
        userId: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void {
        this._enqueue(OP.PROP_SET_TRANSFORM, userId, px, py, pz, qx, qy, qz, qw);
    }
    setDynamicVelocity(
        userId: number,
        lvx: number,
        lvy: number,
        lvz: number,
        avx: number,
        avy: number,
        avz: number
    ): void {
        this._enqueue(OP.PROP_SET_VELOCITY, userId, lvx, lvy, lvz, avx, avy, avz);
    }

    getDynamicCount(): number {
        if (this.dynHeader) return Atomics.load(this.dynHeader, DYN_H_COUNT);
        return this._dynSnapCount;
    }

    getDynamicTransforms(): Float32Array {
        const { dynHeader, dynXfView } = this;
        if (dynHeader && dynXfView) {
            const front = Atomics.load(dynHeader, DYN_H_FRONT);
            const count = Atomics.load(dynHeader, DYN_H_COUNT);
            return dynXfView[front === 1 ? 1 : 0].subarray(0, count * DYN_STRIDE);
        }
        return this._dynSnapXf;
    }

    getDynamicIds(): Float32Array {
        const { dynHeader, dynIdsView } = this;
        if (dynHeader && dynIdsView) {
            const front = Atomics.load(dynHeader, DYN_H_FRONT);
            const count = Atomics.load(dynHeader, DYN_H_COUNT);
            return dynIdsView[front === 1 ? 1 : 0].subarray(0, count);
        }
        return this._dynSnapIds;
    }

    // --- simulation --------------------------------------------------------
    step(): void {
        /* worker-driven */
    }

    /** No-op: flags are bundled into init() and applied to the worker's engine there. */
    setFlags(_flags: number): void {
        /* sent via init() payload; see `init()` above. */
    }

    // --- queries -----------------------------------------------------------
    getTransforms(): Float32Array {
        const { header, xfView } = this;
        if (header && xfView) {
            const front = Atomics.load(header, H_FRONT);
            const count = Atomics.load(header, H_COUNT);
            return xfView[front === 1 ? 1 : 0].subarray(0, count * STRIDE);
        }
        return this._snapXf;
    }

    getDieIds(): Float32Array {
        const { header, idsView } = this;
        if (header && idsView) {
            const front = Atomics.load(header, H_FRONT);
            const count = Atomics.load(header, H_COUNT);
            return idsView[front === 1 ? 1 : 0].subarray(0, count);
        }
        return this._snapIds;
    }

    getFaceValues(): Int32Array {
        const { header, faceValuesView } = this;
        if (faceValuesView && header) {
            const front = Atomics.load(header, H_FRONT);
            const count = Atomics.load(header, H_COUNT);
            return faceValuesView[front === 1 ? 1 : 0].subarray(0, count);
        }
        return this._snapFaceValues;
    }

    getDieFaceValue(id: number): number {
        const ids = this.getDieIds();
        const values = this.getFaceValues();
        for (let i = 0; i < ids.length; i++) {
            if (Math.round(ids[i]) === id) return values[i] | 0;
        }
        return 0;
    }

    getDieCount(): number {
        if (this.header) return Atomics.load(this.header, H_COUNT);
        return this._snapCount;
    }

    areAllSettled(): boolean {
        if (this.header) return Atomics.load(this.header, H_SETTLED) === 1;
        return this._snapSettled;
    }

    /** Last-step broadphase / collision counters (SAB header, when available). */
    getLastStepStats(): StepStats {
        if (this.header) {
            return {
                pairCandidates: Atomics.load(this.header, H_PAIR_CANDIDATES),
                sphereTests: Atomics.load(this.header, H_SPHERE_TESTS),
                satTests: Atomics.load(this.header, H_SAT_TESTS),
                contacts: Atomics.load(this.header, H_CONTACTS),
            };
        }
        return { pairCandidates: 0, sphereTests: 0, satTests: 0, contacts: 0 };
    }

    getCollisionEvents(): Float32Array {
        if (this._eventChunks.length === 0) return new Float32Array(0);
        if (this._eventChunks.length === 1) {
            const only = this._eventChunks[0];
            this._eventChunks = [];
            return only;
        }
        let total = 0;
        for (const c of this._eventChunks) total += c.length;
        const merged = new Float32Array(total);
        let off = 0;
        for (const c of this._eventChunks) {
            merged.set(c, off);
            off += c.length;
        }
        this._eventChunks = [];
        return merged;
    }

    // --- determinism -------------------------------------------------------
    seedRNG(seed: number): void {
        this._send('seedRNG', { seed });
    }
    seededThrow(seed: number, dice: SeededDieRef[], tableSurfaceY: number): void {
        this._send('seededThrow', { seed: seed >>> 0, dice, tableSurfaceY });
    }
    async serializeStateAsync(): Promise<Uint8Array> {
        const res = await this._request('serializeState');
        return new Uint8Array(res.data, 0, res.byteLength);
    }
    randomFloat(): number {
        console.warn(
            '[WorkerPhysics] randomFloat() is unavailable synchronously in worker mode; use seededThrow() for deterministic rolls.'
        );
        return Math.random();
    }
    serializeState(): Uint8Array {
        console.warn(
            '[WorkerPhysics] serializeState() is unavailable synchronously in worker mode; use serializePhysicsState() instead.'
        );
        return new Uint8Array(0);
    }
    deserializeState(data: Uint8Array): void {
        this._send('deserializeState', { data: Array.from(data) });
    }
}

// ---------------------------------------------------------------------------
// Bridge state
// ---------------------------------------------------------------------------

let _engine: WorkerEngineProxy | null = null;
let _available = false;
let _initialized = false;
let _usingSAB = false;
const _searchParams = new URLSearchParams(self.location ? self.location.search : '');

export const flushWorkerCommandBatch = (): void => {
    _engine?.flushCommandBatch();
};

export const loadWasmEngine = async (): Promise<boolean> => {
    if (_initialized) return _available;

    if (_searchParams.has('no-wasm')) {
        _initialized = true;
        _available = false;
        return false;
    }

    try {
        const worker = new Worker(new URL('./dice_physics.worker.ts', import.meta.url), {
            type: 'module',
            name: resolveWasmArtifactDir({ searchParams: _searchParams }),
        });

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('worker boot timeout')), 15000);
            const onReady = (e: MessageEvent) => {
                if (e.data?.type === 'ready') {
                    cleanup();
                    resolve();
                } else if (e.data?.type === 'error') {
                    cleanup();
                    reject(new Error(e.data.payload?.message || 'worker boot error'));
                }
            };
            const onError = (err: ErrorEvent) => {
                cleanup();
                reject(err);
            };
            const cleanup = () => {
                clearTimeout(timeout);
                worker.removeEventListener('message', onReady);
                worker.removeEventListener('error', onError);
            };
            worker.addEventListener('message', onReady);
            worker.addEventListener('error', onError);
        });

        let sab: SharedArrayBuffer | null = null;
        let sabDynamics: SharedArrayBuffer | null = null;
        if (sabSupported()) {
            sab = new SharedArrayBuffer(SAB_BYTES);
            sabDynamics = new SharedArrayBuffer(DYNAMICS_SAB_BYTES);
            _usingSAB = true;
        } else {
            console.warn(
                '[WorkerPhysics] Not cross-origin isolated — falling back to postMessage snapshots (no SharedArrayBuffer).'
            );
        }

        _engine = new WorkerEngineProxy(worker, sab, sabDynamics);
        _available = true;
        console.log(
            `[WorkerPhysics] Worker physics engine loaded (${_usingSAB ? 'SharedArrayBuffer' : 'postMessage'} transport).`
        );
    } catch (err) {
        console.warn('[WorkerPhysics] Worker init failed.', err);
        _engine = null;
        _available = false;
    }

    _initialized = true;
    return _available;
};

export const isWasmAvailable = (): boolean => _initialized && _available;
export const isWasmInitialized = (): boolean => _initialized;
export const isUsingSharedArrayBuffer = (): boolean => _usingSAB;

export const getWasmEngine = (): PhysicsEngine => {
    if (!_initialized)
        throw new Error('[WorkerPhysics] Engine not initialized. Await loadWasmEngine() first.');
    if (!_engine)
        throw new Error('[WorkerPhysics] Engine unavailable — loadWasmEngine() did not succeed.');
    return _engine;
};

/**
 * The live proxy, or null when the worker never came up. Internal helper for
 * the module-level API below, which no-ops rather than throwing when the
 * backend is unavailable (`PhysicsBridge` falls back to the main-thread bridge).
 */
const activeEngine = (): WorkerEngineProxy | null => (_available ? _engine : null);

export const loadHullForDie = (): void => {};

export const pollCollisionEvents = (): CollisionEvent[] => {
    const engine = activeEngine();
    if (!engine) return [];
    return parseCollisionEventBuffer(engine.getCollisionEvents());
};

export const seedPhysicsRNG = (seed: number): void => {
    activeEngine()?.seedRNG(seed >>> 0);
};

export const randomPhysicsFloat = (): number => {
    const engine = activeEngine();
    if (!engine) return Math.random();
    return engine.randomFloat();
};

export const serializePhysicsState = async (): Promise<Uint8Array> => {
    const engine = activeEngine();
    if (!engine) return new Uint8Array(0);
    return engine.serializeStateAsync();
};

export const seededPhysicsThrow = (
    seed: number,
    dice: SeededDieRef[],
    tableSurfaceY: number
): void => {
    activeEngine()?.seededThrow(seed, dice, tableSurfaceY);
};

export const deserializePhysicsState = (data: Uint8Array): void => {
    activeEngine()?.deserializeState(data);
};

export const setContainerActive = (active: boolean): void => {
    activeEngine()?.setContainerActive(active);
};

export const setContainerPlanes = (planes: Float32Array | number[]): void => {
    activeEngine()?.setContainerPlanes(planes);
};
