/**
 * WasmPhysicsBridge.js
 *
 * Async loader for the Emscripten-compiled dice physics WASM module.
 *
 * When the compiled artifacts (public/wasm/dice_physics.js + .wasm) are
 * present the bridge instantiates a real `DicePhysicsEngine` object and
 * exposes it.  When they are absent (e.g. in development before running
 * `npm run build:wasm`) the bridge transparently substitutes a no-op stub
 * so that the rest of the application continues to work.
 *
 * Phase 3 additions:
 *   • Loads hulls.json and provides `loadHullForDie(engine, sides)`
 *   • Exposes `getCollisionEvents()` helper
 *   • Exposes deterministic `seedRNG(seed)` and `randomFloat()`
 *   • State serialisation helpers for replay
 */

import { publicAssetUrl } from '../core/publicAssetUrl.js';
import { parsePhysicsFlags } from './physicsFlags.js';
import { parseCollisionEventBuffer } from './collisionEvents.js';
import { instantiateDicePhysicsModule, WASM_SCALAR_DIR } from './wasmArtifact.js';
import { applyFaceTableForDie } from './faceTableLoader.js';

// ---------------------------------------------------------------------------
// No-op stub
// ---------------------------------------------------------------------------

const STUB_ENGINE = {
    setFlags: () => {},
    init: () => {},
    reset: () => {},
    step: () => {},
    addDie: () => -1,
    removeDie: () => {},
    clearAllDice: () => {},
    setDieMaterial: () => {},
    setDieDrag: () => {},
    setDieHull: () => {},
    setDieFaceTable: () => {},
    getDieFaceValue: () => 0,
    getFaceValues: () => new Int32Array(0),
    applyImpulse: () => {},
    applyTorqueImpulse: () => {},
    setDieTransform: () => {},
    setDieVelocity: () => {},
    setDieKinematic: () => {},
    setContainerActive: () => {},
    setContainerPlanes: () => {},
    clearStatics: () => {},
    removeStatic: () => false,
    addStaticBox: () => -1,
    addStaticPlane: () => -1,
    addStaticConvexHull: () => -1,
    addStaticOpenCylinder: () => -1,
    getTransforms: () => new Float32Array(0),
    getDieIds: () => new Float32Array(0),
    getDieCount: () => 0,
    areAllSettled: () => true,
    getLastStepStats: () => ({
        pairCandidates: 0,
        sphereTests: 0,
        satTests: 0,
        contacts: 0,
    }),
    seedRNG: () => {},
    randomFloat: () => 0.5,
    getCollisionEvents: () => new Float32Array(0),
    serializeState: () => new Uint8Array(0),
    deserializeState: () => {},
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _engine = null;
let _moduleClass = null;
let _available = false;
let _initialized = false;
let _hulls = null;
const _searchParams = new URLSearchParams(window.location.search);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const loadWasmEngine = async () => {
    if (_initialized) return _available;

    if (_searchParams.has('no-wasm')) {
        console.warn('[WasmPhysics] Disabled via ?no-wasm — using JS stub.');
        _engine = STUB_ENGINE;
        _available = false;
        _initialized = true;
        return false;
    }

    try {
        const { Module, dir } = await instantiateDicePhysicsModule({
            searchParams: _searchParams,
        });

        _moduleClass = Module;
        _engine = new Module.DicePhysicsEngine();
        _engine.setFlags(parsePhysicsFlags(_searchParams));
        _available = true;

        // Hulls live next to the SIMD artifact; the scalar build does not duplicate them.
        try {
            const res = await fetch(publicAssetUrl('wasm/hulls.json'));
            if (res.ok) _hulls = await res.json();
        } catch (e) {
            console.warn('[WasmPhysics] Could not load hulls.json:', e);
        }

        const simdLabel = dir === WASM_SCALAR_DIR ? 'scalar' : 'SIMD';
        console.log(`[WasmPhysics] WASM dice physics engine loaded (${simdLabel} artifact).`);
        console.log('[WasmPhysics] Run `npm run build:wasm` to rebuild after C++ changes.');
    } catch (err) {
        const hint =
            err.message && err.message.includes('fetch')
                ? 'WASM binary not found. Run `npm run build:wasm` to compile the C++ module.'
                : err.message;
        console.warn(`[WasmPhysics] WASM module unavailable — using JS stub. (${hint})`);
        _engine = STUB_ENGINE;
        _available = false;
    }

    _initialized = true;
    return _available;
};

export const isWasmAvailable = () => _initialized && _available;
export const isWasmInitialized = () => _initialized;

export const getWasmEngine = () => {
    if (!_initialized) {
        throw new Error('[WasmPhysics] Engine not initialized. Await loadWasmEngine() first.');
    }
    return _engine;
};

/**
 * Load the convex hull for a die into the WASM engine.
 * @param {number} wasmId — die ID returned by engine.addDie()
 * @param {number} sides — 4, 6, 8, 10, 12, 20
 */
export const loadHullForDie = (wasmId, sides) => {
    if (!_available || !_hulls || !_moduleClass) return;
    const type = 'd' + sides;
    const data = _hulls[type];
    if (!data || !data.vertices) return;
    const flat = new _moduleClass.VectorFloat();
    for (let i = 0; i < data.vertices.length; i++) {
        flat.push_back(data.vertices[i][0]);
        flat.push_back(data.vertices[i][1]);
        flat.push_back(data.vertices[i][2]);
    }
    _engine.setDieHull(wasmId, flat);
    applyFaceTableForDie(_engine, _moduleClass, wasmId, data);
};

/**
 * Read collision events from the WASM engine.
 * Returns array of { idA, idB, impactSpeed, mass, inertiaScalar, linearSpeedSq, angularSpeedSq } objects.
 */
export const pollCollisionEvents = () => {
    if (!_available) return [];
    const buf = _engine.getCollisionEvents();
    return parseCollisionEventBuffer(buf);
};

/**
 * Deterministic random helpers (seeded from JS).
 */
export const seedPhysicsRNG = (seed) => {
    if (!_available) return;
    _engine.seedRNG(seed >>> 0);
};

export const randomPhysicsFloat = () => {
    if (!_available) return Math.random();
    return _engine.randomFloat();
};

/**
 * State serialisation for replay.
 */
export const serializePhysicsState = async () => {
    if (!_available || !_moduleClass) return new Uint8Array(0);
    const vec = _engine.serializeState();
    const arr = new Uint8Array(vec.size());
    for (let i = 0; i < vec.size(); i++) arr[i] = vec.get(i);
    return arr;
};

/** No-op in the in-process bridge — throws are applied directly via the engine. */
export const seededPhysicsThrow = () => {};

export const deserializePhysicsState = (data) => {
    if (!_available || !_moduleClass) return;
    const vec = new _moduleClass.VectorU8();
    for (let i = 0; i < data.length; i++) vec.push_back(data[i]);
    _engine.deserializeState(vec);
};

/** Enable/disable dice-cup interior collision planes. */
export const setContainerActive = (active) => {
    if (!_available) return;
    _engine.setContainerActive(!!active);
};

/**
 * Upload world-space container planes (4 floats each: nx, ny, nz, d).
 * @param {Float32Array|number[]} planes
 */
export const setContainerPlanes = (planes) => {
    if (!_available || !_moduleClass) return;
    const flat = planes instanceof Float32Array ? planes : Float32Array.from(planes);
    const vec = new _moduleClass.VectorFloat();
    for (let i = 0; i < flat.length; i++) vec.push_back(flat[i]);
    _engine.setContainerPlanes(vec);
    if (typeof vec.delete === 'function') vec.delete();
};

/** Last-step broadphase / collision counters (main-thread WASM engine). */
export const getPhysicsStepStats = () => {
    if (!_available || typeof _engine.getLastStepStats !== 'function') return null;
    return _engine.getLastStepStats();
};
