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

// ---------------------------------------------------------------------------
// No-op stub
// ---------------------------------------------------------------------------

const STUB_ENGINE = {
    init:               () => {},
    reset:              () => {},
    step:               () => {},
    addDie:             () => -1,
    removeDie:          () => {},
    clearAllDice:       () => {},
    setDieMaterial:     () => {},
    setDieDrag:         () => {},
    setDieHull:         () => {},
    applyImpulse:       () => {},
    applyTorqueImpulse: () => {},
    setDieTransform:    () => {},
    setDieVelocity:     () => {},
    getTransforms:      () => new Float32Array(0),
    getDieIds:          () => new Float32Array(0),
    getDieCount:        () => 0,
    areAllSettled:      () => true,
    seedRNG:            () => {},
    randomFloat:        () => 0.5,
    getCollisionEvents: () => new Float32Array(0),
    serializeState:     () => new Uint8Array(0),
    deserializeState:   () => {},
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _engine      = null;
let _moduleClass = null;
let _available   = false;
let _initialized = false;
let _hulls       = null;
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
        const dynamicImport = new Function('u', 'return import(u)');
        const moduleFactory = await dynamicImport(publicAssetUrl('wasm/dice_physics.js'));
        // UMD Emscripten output: try .default first, then the module itself
        const ModuleFactory = moduleFactory.default || moduleFactory;
        const Module = await ModuleFactory();

        _moduleClass = Module;
        _engine      = new Module.DicePhysicsEngine();
        _available   = true;

        // Pre-load hulls.json for fast die registration
        try {
            const res = await fetch(publicAssetUrl('wasm/hulls.json'));
            if (res.ok) _hulls = await res.json();
        } catch (e) {
            console.warn('[WasmPhysics] Could not load hulls.json:', e);
        }

        console.log('[WasmPhysics] WASM dice physics engine loaded successfully.');
        console.log('[WasmPhysics] Run `npm run build:wasm` to rebuild after C++ changes.');

    } catch (err) {
        const hint = err.message && err.message.includes('fetch')
            ? 'WASM binary not found. Run `npm run build:wasm` to compile the C++ module.'
            : err.message;
        console.warn(`[WasmPhysics] WASM module unavailable — using JS stub. (${hint})`);
        _engine    = STUB_ENGINE;
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
};

/**
 * Read collision events from the WASM engine.
 * Returns array of { idA, idB, impactSpeed, mass, inertiaScalar, linearSpeedSq, angularSpeedSq } objects.
 */
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
export const serializePhysicsState = () => {
    if (!_available || !_moduleClass) return new Uint8Array(0);
    const vec = _engine.serializeState();
    const arr = new Uint8Array(vec.size());
    for (let i = 0; i < vec.size(); i++) arr[i] = vec.get(i);
    return arr;
};

export const deserializePhysicsState = (data) => {
    if (!_available || !_moduleClass) return;
    const vec = new _moduleClass.VectorU8();
    for (let i = 0; i < data.length; i++) vec.push_back(data[i]);
    _engine.deserializeState(vec);
};
