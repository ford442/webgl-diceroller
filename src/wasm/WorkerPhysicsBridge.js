/**
 * WorkerPhysicsBridge.js
 *
 * EXPERIMENTAL: Drop-in replacement for WasmPhysicsBridge.js that runs the
 * physics engine inside a Web Worker.  This offloads simulation from the main
 * thread, allowing 120 Hz physics even when the renderer is capped at 60 fps.
 *
 * Enable via URL flag: ?worker-physics
 *
 * Usage is identical to WasmPhysicsBridge.js:
 *   import { loadWasmEngine, getWasmEngine, isWasmAvailable } from './wasm/WorkerPhysicsBridge.js';
 */

// ---------------------------------------------------------------------------
// Worker wrapper that mimics the DicePhysicsEngine API
// ---------------------------------------------------------------------------

class WorkerEngineProxy {
    constructor(worker) {
        this.worker = worker;
        this.pending = new Map();
        this.nextReqId = 1;
        this.latestTransforms = new Float32Array(0);
        this.latestEvents = new Float32Array(0);
        this.dieCount = 0;

        worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'stepped') {
                this.latestTransforms = payload.transforms;
                this.latestEvents = payload.events;
                // Approximate die count from transform length
                this.dieCount = Math.floor(this.latestTransforms.length / 7);
            } else if (type === 'dieAdded' || type === 'random' || type === 'state') {
                const req = this.pending.get(payload.requestId);
                if (req) { req.resolve(payload); this.pending.delete(payload.requestId); }
            } else if (type === 'error') {
                console.error('[WorkerPhysics]', payload.message);
            }
        };
    }

    _send(type, payload = {}) {
        this.worker.postMessage({ type, payload });
    }

    _request(type, payload = {}) {
        const id = this.nextReqId++;
        return new Promise((resolve) => {
            this.pending.set(id, { resolve });
            this.worker.postMessage({ type, payload: { ...payload, requestId: id } });
        });
    }

    init(gravity, tableY, tableHalfW, tableHalfD) {
        this._send('init', { gravity, tableY, tableHalfW, tableHalfD });
    }

    reset() { this._send('reset'); }

    async addDie(sides, x, y, z, hull = null) {
        const result = await this._request('addDie', { sides, x, y, z, hull });
        return result.id;
    }

    removeDie(id) { this._send('removeDie', { id }); }
    clearAllDice() { this._send('clearAllDice'); }

    setDieHull(id, hullArray) { this._send('addDie', { id, hull: hullArray }); }
    applyImpulse(id, fx, fy, fz) { this._send('applyImpulse', { id, fx, fy, fz }); }
    applyTorqueImpulse(id, tx, ty, tz) { this._send('applyTorqueImpulse', { id, tx, ty, tz }); }
    setDieTransform(id, px, py, pz, qx, qy, qz, qw) {
        this._send('setDieTransform', { id, px, py, pz, qx, qy, qz, qw });
    }
    setDieVelocity(id, lvx, lvy, lvz, avx, avy, avz) {
        this._send('setDieVelocity', { id, lvx, lvy, lvz, avx, avy, avz });
    }

    step(dt) { this._send('step', { dt }); }
    getTransforms() { return this.latestTransforms; }
    getCollisionEvents() { return this.latestEvents; }
    getDieCount() { return this.dieCount; }
    areAllSettled() {
        // Approximation: if no transforms have changed significantly since last step
        // For a proper implementation, track per-body sleep state in worker
        return false;
    }

    seedRNG(seed) { this._send('seedRNG', { seed }); }
    randomFloat() {
        // Not async-friendly in current API; return Math.random() as fallback
        console.warn('[WorkerPhysics] randomFloat() is async-only in worker mode');
        return Math.random();
    }

    serializeState() {
        console.warn('[WorkerPhysics] serializeState() is async-only in worker mode');
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

export const loadWasmEngine = async () => {
    if (_initialized) return _available;

    try {
        const worker = new Worker('/wasm/dice_physics.worker.js', { type: 'module' });
        _engine = new WorkerEngineProxy(worker);
        _available = true;
        console.log('[WorkerPhysics] Worker-based physics engine loaded.');
    } catch (err) {
        console.warn('[WorkerPhysics] Worker failed — physics unavailable.', err);
        _engine = null;
        _available = false;
    }

    _initialized = true;
    return _available;
};

export const isWasmAvailable = () => _initialized && _available;
export const isWasmInitialized = () => _initialized;

export const getWasmEngine = () => {
    if (!_initialized) throw new Error('[WorkerPhysics] Engine not initialized.');
    return _engine;
};

// Hull helper (same API as WasmPhysicsBridge)
export const loadHullForDie = (wasmId, sides) => {
    // Not used in worker mode; hulls are passed at addDie time
};

export const pollCollisionEvents = () => {
    if (!_available) return [];
    const buf = _engine.getCollisionEvents();
    const out = [];
    for (let i = 0; i < buf.length; i += 7) {
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

export const serializePhysicsState = () => {
    if (!_available) return new Uint8Array(0);
    return _engine.serializeState();
};

export const deserializePhysicsState = (data) => {
    if (!_available) return;
    _engine.deserializeState(data);
};
