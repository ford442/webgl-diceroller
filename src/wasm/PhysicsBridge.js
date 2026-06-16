/**
 * PhysicsBridge.js
 *
 * Facade that selects the physics backend at startup and re-exports the common
 * bridge API.  Importers (`dice.js`, `main.js`, `interaction.js`) talk to this
 * module and never need to know which backend is live.
 *
 * Selection (Phase 4 makes the worker the default):
 *   1. `?no-wasm`            → main-thread bridge (serves the no-op stub).
 *   2. `?no-worker` / `?worker-physics=off`
 *                           → main-thread WASM bridge (in-process engine).
 *   3. default              → worker bridge; on any failure (no Worker support,
 *                              boot timeout, etc.) gracefully fall back to the
 *                              main-thread bridge so the app always runs.
 *
 * `?worker-physics` (no value) still works as an explicit opt-in and is the
 * same as the default.
 */

import * as workerBridge from './WorkerPhysicsBridge.js';
import * as mainBridge from './WasmPhysicsBridge.js';

const _params = new URLSearchParams(window.location.search);

const _forceMain =
    _params.has('no-wasm') ||
    _params.has('no-worker') ||
    _params.get('worker-physics') === 'off';

// `active` is swapped to the chosen backend during loadWasmEngine(). Until then
// it points at the main bridge so any early accidental call is harmless.
let active = mainBridge;

export const loadWasmEngine = async () => {
    if (_forceMain || typeof Worker === 'undefined') {
        active = mainBridge;
        return active.loadWasmEngine();
    }

    // Try the worker first; fall back to the main-thread engine on failure.
    const ok = await workerBridge.loadWasmEngine();
    if (ok) {
        active = workerBridge;
        return true;
    }

    console.warn('[PhysicsBridge] Worker backend unavailable — using main-thread WASM bridge.');
    active = mainBridge;
    return active.loadWasmEngine();
};

// --- delegated API ---------------------------------------------------------

export const isWasmAvailable = () => active.isWasmAvailable();
export const isWasmInitialized = () => active.isWasmInitialized();
export const getWasmEngine = () => active.getWasmEngine();
export const loadHullForDie = (...a) => active.loadHullForDie(...a);
export const pollCollisionEvents = (...a) => active.pollCollisionEvents(...a);
export const seedPhysicsRNG = (...a) => active.seedPhysicsRNG(...a);
export const randomPhysicsFloat = (...a) => active.randomPhysicsFloat(...a);
export const serializePhysicsState = (...a) => active.serializePhysicsState(...a);
export const deserializePhysicsState = (...a) => active.deserializePhysicsState(...a);

/** True when the worker backend is live and using SharedArrayBuffer transport. */
export const isUsingWorkerPhysics = () => active === workerBridge;
export const isUsingSharedArrayBuffer = () =>
    active === workerBridge && workerBridge.isUsingSharedArrayBuffer();
