/**
 * WorkerPhysicsBridge.js
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
    MAX_DICE, STRIDE, HEADER_INTS, H_FRONT, H_COUNT, H_SETTLED,
    H_CMD_HEAD, H_CMD_TAIL,
    idsOffset, xfOffset, SAB_BYTES, CMD_RING_FLOATS, CMD_RING_OFFSET,
    sabSupported,
} from './workerLayout.js';
import { parsePhysicsFlags } from './physicsFlags.js';
import {
    OP, copyIntoRing, countRecords,
} from './workerCommands.js';

// ---------------------------------------------------------------------------
// Debug / perf counters (surfaced via getWorkerPhysicsStats)
// ---------------------------------------------------------------------------

const _stats = {
    structuralMsgs: 0,
    batchMsgs: 0,
    batchRecords: 0,
    lastSampleAt: typeof performance !== 'undefined' ? performance.now() : 0,
    msgsPerSecond: 0,
};

function _noteStructuralMsg() {
    _stats.structuralMsgs++;
}

function _noteBatchMsg(recordCount) {
    _stats.batchMsgs++;
    _stats.batchRecords += recordCount;
}

export function getWorkerPhysicsStats() {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = (now - _stats.lastSampleAt) / 1000;
    if (dt >= 0.2) {
        _stats.msgsPerSecond = dt > 0
            ? (_stats.structuralMsgs + _stats.batchMsgs) / dt
            : 0;
        _stats.structuralMsgs = 0;
        _stats.batchMsgs = 0;
        _stats.batchRecords = 0;
        _stats.lastSampleAt = now;
    }
    return {
        usingCommandBatch: true,
        usingSAB: _usingSAB,
        msgsPerSecond: _stats.msgsPerSecond,
        batchRecords: _stats.batchRecords,
    };
}

const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Synchronous proxy mimicking DicePhysicsEngine
// ---------------------------------------------------------------------------

class WorkerEngineProxy {
    constructor(worker, sab) {
        this.worker = worker;

        this._nextId = 0;
        this._count = 0;

        this.sab = sab;
        this.cmdRing = null;
        this._cmdHead = 0;

        // Per-frame scratch (used for accumulation; SAB flush copies from here).
        this._scratch = new Float32Array(1024);
        this._scratchLen = 0;

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
            this.cmdRing = new Float32Array(sab, CMD_RING_OFFSET, CMD_RING_FLOATS);
            Atomics.store(this.header, H_CMD_HEAD, 0);
            Atomics.store(this.header, H_CMD_TAIL, 0);
        } else {
            this.header = null;
        }

        this._snapIds = new Float32Array(0);
        this._snapXf = new Float32Array(0);
        this._snapCount = 0;
        this._snapSettled = true;
        this._eventChunks = [];

        // Async request/response (serializeState, etc.).
        this._pending = new Map();
        this._nextReqId = 1;

        worker.onmessage = (e) => this._onMessage(e.data);
    }

    _onMessage({ type, payload }) {
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
                this._snapCount = payload.count;
                this._snapSettled = payload.settled;
                break;
            case 'events':
                this._eventChunks.push(payload.events);
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

_send(type, payload = {}, transfer = []) {
        this.flushCommandBatch();
        _noteStructuralMsg();
        this.worker.postMessage({ type, payload }, transfer);
    }

    _request(type, payload = {}, transfer = []) {
        const reqId = this._nextReqId++;
        return new Promise((resolve, reject) => {
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

    _ensureScratch(room) {
        if (this._scratchLen + room <= this._scratch.length) return;
        const next = new Float32Array(Math.max(this._scratch.length * 2, this._scratchLen + room));
        next.set(this._scratch.subarray(0, this._scratchLen));
        this._scratch = next;
    }

    _enqueue(opcode, id, a, b, c, d, e, f, g) {
        const len = opcode === OP.SET_TRANSFORM ? 9
            : opcode === OP.SET_VELOCITY ? 8
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
    flushCommandBatch() {
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
            this.worker.postMessage(
                { type: 'batch', payload: { commands: copy } },
                [copy.buffer]
            );
        }

        this._scratchLen = 0;
    }

    // --- lifecycle ---------------------------------------------------------
    init(gravity, tableY, tableHalfW, tableHalfD) {
        this._send('init', {
            gravity, tableY, tableHalfW, tableHalfD,
            flags: parsePhysicsFlags(_searchParams),
            sab: this.sab || null,
        });
    }

    reset() {
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
    addDie(sides, x, y, z) {
        if (this._count >= MAX_DICE) return -1;
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) return -1;
        const id = this._nextId++;
        this._count++;
        this._send('addDie', { sides, x, y, z, expectedId: id });
        return id;
    }

    removeDie(id) {
        if (this._count > 0) this._count--;
        this._send('removeDie', { id });
    }

    clearAllDice() {
        this._count = 0;
        this._send('clearAllDice');
    }

    setDieHull(id, sides) { this._send('setDieHull', { id, sides }); }
    setDieMaterial(id, friction, rollingFriction) {
        this._send('setDieMaterial', { id, friction, rollingFriction });
    }
    setDieDrag(id, drag) { this._send('setDieDrag', { id, drag }); }

    // --- forces (batched) --------------------------------------------------
    applyImpulse(id, fx, fy, fz) {
        this._enqueue(OP.APPLY_IMPULSE, id, fx, fy, fz);
    }
    applyTorqueImpulse(id, tx, ty, tz) {
        this._enqueue(OP.APPLY_TORQUE, id, tx, ty, tz);
    }

    // --- state sync (batched) ----------------------------------------------
    setDieTransform(id, px, py, pz, qx, qy, qz, qw) {
        this._enqueue(OP.SET_TRANSFORM, id, px, py, pz, qx, qy, qz, qw);
    }
    setDieVelocity(id, lvx, lvy, lvz, avx, avy, avz) {
        this._enqueue(OP.SET_VELOCITY, id, lvx, lvy, lvz, avx, avy, avz);
    }
    setDieKinematic(id, kinematic) {
        this._send('setDieKinematic', { id, kinematic });
    }

    // --- simulation --------------------------------------------------------
    step() { /* worker-driven */ }

    // --- queries -----------------------------------------------------------
    getTransforms() {
        if (this.header) {
            const front = Atomics.load(this.header, H_FRONT);
            const count = Atomics.load(this.header, H_COUNT);
            return this.xfView[front].subarray(0, count * STRIDE);
        }
        return this._snapXf;
    }

    getDieIds() {
        if (this.header) {
            const front = Atomics.load(this.header, H_FRONT);
            const count = Atomics.load(this.header, H_COUNT);
            return this.idsView[front].subarray(0, count);
        }
        return this._snapIds;
    }

    getDieCount() {
        if (this.header) return Atomics.load(this.header, H_COUNT);
        return this._snapCount;
    }

    areAllSettled() {
        if (this.header) return Atomics.load(this.header, H_SETTLED) === 1;
        return this._snapSettled;
    }

    getCollisionEvents() {
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
        for (const c of this._eventChunks) { merged.set(c, off); off += c.length; }
        this._eventChunks = [];
        return merged;
    }

    // --- determinism -------------------------------------------------------
    seedRNG(seed) { this._send('seedRNG', { seed }); }
    seededThrow(seed, dice, tableSurfaceY) {
        this._send('seededThrow', { seed: seed >>> 0, dice, tableSurfaceY });
    }
    async serializeStateAsync() {
        const res = await this._request('serializeState');
        return new Uint8Array(res.data, 0, res.byteLength);
    }
    randomFloat() {
        console.warn('[WorkerPhysics] randomFloat() is unavailable synchronously in worker mode; use seededThrow() for deterministic rolls.');
        return Math.random();
    }
    serializeState() {
        console.warn('[WorkerPhysics] serializeState() is unavailable synchronously in worker mode; use serializePhysicsState() instead.');
        return new Uint8Array(0);
    }
    deserializeState(data) { this._send('deserializeState', { data: Array.from(data) }); }
}

// ---------------------------------------------------------------------------
// Bridge state
// ---------------------------------------------------------------------------

let _engine = null;
let _available = false;
let _initialized = false;
let _usingSAB = false;
const _searchParams = new URLSearchParams(self.location ? self.location.search : '');

export const flushWorkerCommandBatch = () => {
    _engine?.flushCommandBatch?.();
};

export const loadWasmEngine = async () => {
    if (_initialized) return _available;

    if (_searchParams.has('no-wasm')) {
        _initialized = true;
        _available = false;
        return false;
    }

    try {
        const worker = new Worker(new URL('./dice_physics.worker.js', import.meta.url), { type: 'module' });

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('worker boot timeout')), 15000);
            const onReady = (e) => {
                if (e.data?.type === 'ready') {
                    cleanup();
                    resolve();
                } else if (e.data?.type === 'error') {
                    cleanup();
                    reject(new Error(e.data.payload?.message || 'worker boot error'));
                }
            };
            const onError = (err) => { cleanup(); reject(err); };
            const cleanup = () => {
                clearTimeout(timeout);
                worker.removeEventListener('message', onReady);
                worker.removeEventListener('error', onError);
            };
            worker.addEventListener('message', onReady);
            worker.addEventListener('error', onError);
        });

        let sab = null;
        if (sabSupported()) {
            sab = new SharedArrayBuffer(SAB_BYTES);
            _usingSAB = true;
        } else {
            console.warn('[WorkerPhysics] Not cross-origin isolated — falling back to postMessage snapshots (no SharedArrayBuffer).');
        }

        _engine = new WorkerEngineProxy(worker, sab);
        _available = true;
        console.log(`[WorkerPhysics] Worker physics engine loaded (${_usingSAB ? 'SharedArrayBuffer' : 'postMessage'} transport).`);
    } catch (err) {
        console.warn('[WorkerPhysics] Worker init failed.', err);
        _engine = null;
        _available = false;
    }

    _initialized = true;
    return _available;
};

export const isWasmAvailable = () => _initialized && _available;
export const isWasmInitialized = () => _initialized;
export const isUsingSharedArrayBuffer = () => _usingSAB;

export const getWasmEngine = () => {
    if (!_initialized) throw new Error('[WorkerPhysics] Engine not initialized. Await loadWasmEngine() first.');
    return _engine;
};

export const loadHullForDie = () => {};

export const pollCollisionEvents = () => {
    if (!_available) return [];
    const buf = _engine.getCollisionEvents();
    const out = [];
    for (let i = 0; i + 6 < buf.length; i += 7) {
        out.push({
            idA: Math.round(buf[i]),
            idB: Math.round(buf[i + 1]),
            impactSpeed: buf[i + 2],
            mass: buf[i + 3],
            inertiaScalar: buf[i + 4],
            linearSpeedSq: buf[i + 5],
            angularSpeedSq: buf[i + 6],
        });
    }
    return out;
};

export const seedPhysicsRNG = (seed) => {
    if (!_available) return;
    _engine.seedRNG(seed >>> 0);
};

export const randomPhysicsFloat = () => {
    if (!_available) return Math.random();
    return _engine.randomFloat();
};

export const serializePhysicsState = async () => {
    if (!_available) return new Uint8Array(0);
    return _engine.serializeStateAsync();
};

export const seededPhysicsThrow = (seed, dice, tableSurfaceY) => {
    if (!_available) return;
    _engine.seededThrow(seed, dice, tableSurfaceY);
};

export const deserializePhysicsState = (data) => {
    if (!_available) return;
    _engine.deserializeState(data);
};
