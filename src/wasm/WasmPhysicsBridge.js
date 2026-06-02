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
 * Usage:
 *   import { loadWasmEngine, getWasmEngine, isWasmAvailable } from './wasm/WasmPhysicsBridge.js';
 *
 *   // During app initialisation:
 *   const wasmReady = await loadWasmEngine();
 *
 *   // Per-frame (Phase 2: replace ammo.js step):
 *   if (isWasmAvailable()) {
 *       getWasmEngine().step(deltaTime);
 *   }
 *
 * Build the WASM artifacts:
 *   npm run build:wasm   (requires Emscripten SDK — see docs/WASM_ENGINE.md)
 */

// ---------------------------------------------------------------------------
// No-op stub — used when the WASM binary has not been compiled yet.
// ---------------------------------------------------------------------------

const STUB_ENGINE = {
    init:               () => {},
    reset:              () => {},
    step:               () => {},
    addDie:             () => -1,
    removeDie:          () => {},
    clearAllDice:       () => {},
    applyImpulse:       () => {},
    applyTorqueImpulse: () => {},
    setDieTransform:    () => {},
    setDieVelocity:     () => {},
    getTransforms:      () => new Float32Array(0),
    getDieCount:        () => 0,
    areAllSettled:      () => true,
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _engine      = null;
let _available   = false;
let _initialized = false;
const _searchParams = new URLSearchParams(window.location.search);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the WASM engine asynchronously.
 *
 * Safe to call multiple times — subsequent calls resolve immediately with the
 * cached result.
 *
 * @returns {Promise<boolean>}  true if the real WASM engine was loaded,
 *                              false if the stub is in use.
 */
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
        // Dynamic import of the Emscripten-generated module loader.
        // The .js loader and .wasm binary must both be present in public/wasm/.
        // Vite serves public/ at the root, so the URL is /wasm/dice_physics.js.
        //
        // We use the Function constructor to prevent Rollup from attempting to
        // statically resolve this path during `npm run build`.  The file is a
        // runtime-only asset served from public/ — it is not bundled.
        const dynamicImport = new Function('u', 'return import(u)');
        const moduleFactory = await dynamicImport('/wasm/dice_physics.js');
        const Module = await moduleFactory.default();

        _engine    = new Module.DicePhysicsEngine();
        _available = true;

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

/**
 * Returns true if the real WASM module was loaded (not the stub).
 * Valid only after loadWasmEngine() has resolved.
 */
export const isWasmAvailable = () => _available;

/**
 * Returns true if loadWasmEngine() has been called and resolved
 * (regardless of whether the real WASM or the stub is in use).
 */
export const isWasmInitialized = () => _initialized;

/**
 * Returns the active engine instance (real WASM or stub).
 *
 * @throws {Error} if called before loadWasmEngine() has resolved.
 *
 * Engine API surface:
 *   engine.init(gravity, tableY, tableHalfW, tableHalfD)
 *   engine.reset()
 *   engine.step(deltaTime)
 *   engine.addDie(sides, x, y, z)  → id (int)
 *   engine.removeDie(id)
 *   engine.clearAllDice()
 *   engine.applyImpulse(id, fx, fy, fz)
 *   engine.applyTorqueImpulse(id, tx, ty, tz)
 *   engine.setDieTransform(id, px,py,pz, qx,qy,qz,qw)
 *   engine.setDieVelocity(id, lvx,lvy,lvz, avx,avy,avz)
 *   engine.getTransforms()  → Float32Array [px,py,pz,qx,qy,qz,qw, ...]
 *   engine.getDieCount()    → int
 *   engine.areAllSettled()  → bool
 */
export const getWasmEngine = () => {
    if (!_initialized) {
        throw new Error('[WasmPhysics] Engine not initialized. Await loadWasmEngine() first.');
    }
    return _engine;
};
