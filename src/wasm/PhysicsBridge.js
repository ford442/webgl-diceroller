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
// Typed as the shared contract (not `typeof workerBridge | typeof mainBridge`)
// so a signature drift between the two concrete bridges fails typecheck here
// instead of only showing up as a runtime mismatch.
/** @type {import('./physicsTypes').PhysicsBridgeModule} */
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
export const loadHullForDie = (wasmId, sides) => active.loadHullForDie(wasmId, sides);
export const pollCollisionEvents = () => active.pollCollisionEvents();
export const seedPhysicsRNG = (seed) => active.seedPhysicsRNG(seed);
export const randomPhysicsFloat = () => active.randomPhysicsFloat();
export const serializePhysicsState = () => active.serializePhysicsState();
export const deserializePhysicsState = (data) => active.deserializePhysicsState(data);

/** True when the worker backend is live and using SharedArrayBuffer transport. */
export const isUsingWorkerPhysics = () => active === workerBridge;
export const isUsingSharedArrayBuffer = () =>
    active === workerBridge && workerBridge.isUsingSharedArrayBuffer();

/** Flush batched per-frame worker commands (no-op on the main-thread bridge). */
export const flushWorkerCommandBatch = () => {
    if (active === workerBridge) workerBridge.flushWorkerCommandBatch();
};

/** Worker transport stats for ?debug-perf (null when not on the worker bridge). */
export const getWorkerPhysicsStats = () =>
    active === workerBridge ? workerBridge.getWorkerPhysicsStats() : null;
