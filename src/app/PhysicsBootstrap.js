/**
 * WASM-only physics bring-up. WASM is required — there is no ammo.js
 * fallback. If the engine fails to load (`?no-wasm`, missing/broken
 * artifacts, an environment that never compiled `public/wasm/`), this shows
 * an honest error banner and reports `wasmAvailable: false`; main.js still
 * finishes loading the tavern environment (table, walls, props), it just
 * skips spawning dice, since a static tavern with no dice is a better
 * product than a silently different physics engine.
 */

import { loadWasmEngine, isWasmAvailable, getWasmEngine } from '../wasm/PhysicsBridge.js';

export function showLoadFailure(message) {
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = message;
    setTimeout(() => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity 0.5s';
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 500);
        }
    }, 3000);
}

/**
 * @param {import('../types/app').AppContext} app
 * @returns {Promise<{ wasmAvailable: boolean }>}
 */
export async function bootstrapPhysics(app) {
    const wasmAvailable = await loadWasmEngine();
    app.physics.getWasmEngine = getWasmEngine;
    app.physics.isWasmAvailable = isWasmAvailable;

    if (!wasmAvailable) {
        console.warn('Physics engine unavailable — loading a static tavern with no dice.');
        showLoadFailure('Physics engine failed to load — no dice this session. Check console.');
        return { wasmAvailable };
    }

    const eng = getWasmEngine();
    eng.init(-15.0, -2.75, 18.0, 18.0);
    console.log('[WasmPhysics] Engine initialized and ready.');

    return { wasmAvailable };
}
