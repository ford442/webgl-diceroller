/**
 * WorkerPhysicsBridge.js
 *
 * Production worker-backed physics bridge (Phase 4).  Exposes the *exact same*
 * synchronous API as WasmPhysicsBridge.js so it is a drop-in replacement —
 * `dice.js` / `main.js` cannot tell which bridge they are talking to.
 *
 * The trick that makes the API synchronous despite the worker boundary: the C++
 * engine allocates die ids from a monotonic counter (`nextId_++`, never reused;
 * reset()→0, clearAllDice() keeps it).  We mirror that counter on the main
 * thread so `addDie()` can return the id immediately, then post the command to
 * the worker which performs the identical allocation.  The worker reports its
 * actual id back so we can assert the mirror never drifts.
 *
 * Transforms flow back through a double-buffered SharedArrayBuffer when the page
 * is cross-origin isolated; otherwise the worker posts copied snapshots.  Either
 * way `getTransforms()` / `getDieIds()` are synchronous reads of the latest
 * frame.
 */

import {
    MAX_DICE, STRIDE, HEADER_INTS, H_FRONT, H_COUNT, H_SETTLED,
    idsOffset, xfOffset, SAB_BYTES, sabSupported,
} from './workerLayout.js';
import { parsePhysicsFlags } from './physicsFlags.js';

const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Synchronous proxy mimicking DicePhysicsEngine
// ---------------------------------------------------------------------------

class WorkerEngineProxy {
    constructor(worker, sab) {
        this.worker = worker;

        // Mirror of the engine's monotonic id allocator.
        this._nextId = 0;
        this._count = 0;

        // SAB views (null in snapshot-fallback mode).
        this.sab = sab;
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
        } else {
            this.header = null;
        }

        // Snapshot-fallback latest frame.
        this._snapIds = new Float32Array(0);
        this._snapXf = new Float32Array(0);
        this._snapCount = 0;
        this._snapSettled = true;

        // Collision events accumulate between polls.
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

    // --- lifecycle ---------------------------------------------------------
    init(gravity, tableY, tableHalfW, tableHalfD) {
        this._send('init', {
            gravity, tableY, tableHalfW, tableHalfD,
            flags: parsePhysicsFlags(_searchParams),
            sab: this.sab || null,
        });
    }

    reset() {
        this._nextId = 0;
        this._count = 0;
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
        this._count = 0;                 // engine keeps nextId_ across clearAllDice
        this._send('clearAllDice');
    }

    setDieHull(id, sides) { this._send('setDieHull', { id, sides }); }
    setDieMaterial(id, friction, rollingFriction) {
        this._send('setDieMaterial', { id, friction, rollingFriction });
    }
    setDieDrag(id, drag) { this._send('setDieDrag', { id, drag }); }

    // --- forces ------------------------------------------------------------
    applyImpulse(id, fx, fy, fz) { this._send('applyImpulse', { id, fx, fy, fz }); }
    applyTorqueImpulse(id, tx, ty, tz) { this._send('applyTorqueImpulse', { id, tx, ty, tz }); }

    // --- state sync --------------------------------------------------------
    setDieTransform(id, px, py, pz, qx, qy, qz, qw) {
        this._send('setDieTransform', { id, px, py, pz, qx, qy, qz, qw });
    }
    setDieVelocity(id, lvx, lvy, lvz, avx, avy, avz) {
        this._send('setDieVelocity', { id, lvx, lvy, lvz, avx, avy, avz });
    }
    setDieKinematic(id, kinematic) {
        this._send('setDieKinematic', { id, kinematic });
    }

    // --- simulation --------------------------------------------------------
    // The worker self-paces its own fixed-timestep loop, so the main thread no
    // longer drives stepping.  This is intentionally a no-op.
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

export const loadWasmEngine = async () => {
    if (_initialized) return _available;

    if (_searchParams.has('no-wasm')) {
        _initialized = true;
        _available = false;
        return false;
    }

    try {
        const worker = new Worker(new URL('./dice_physics.worker.js', import.meta.url), { type: 'module' });

        // Wait for the worker to finish booting the WASM module (or fail).
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

// Hulls are loaded inside the worker and attached at addDie time, so this is a
// no-op in worker mode (kept for API parity with WasmPhysicsBridge).
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
