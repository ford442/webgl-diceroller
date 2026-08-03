/**
 * WASM-first physics bring-up: initialise the custom WASM engine, then the
 * ammo fallback world (skipped once WASM is authoritative). Shows the
 * loading-overlay error state and returns `null` on failure so main.js can
 * bail out of init() the same way the inline version did.
 */

import { initPhysics, shouldLoadAmmoPhysics } from '../physics.js';
import * as physicsSession from '../physics.js';
import { loadWasmEngine, isWasmAvailable, getWasmEngine } from '../wasm/PhysicsBridge.js';
import { setAmmoDiceBackend } from '../dice/DiceState.js';

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
 * @returns {Promise<{ wasmAvailable: boolean, physicsWorld: import('../types/ammo').AmmoWorld | null } | null>}
 */
export async function bootstrapPhysics(app) {
    const wasmAvailable = await loadWasmEngine();
    app.physics.getWasmEngine = getWasmEngine;
    app.physics.isWasmAvailable = isWasmAvailable;
    if (wasmAvailable) {
        const eng = getWasmEngine();
        eng.init(-15.0, -2.75, 18.0, 18.0);
        console.log('[WasmPhysics] Engine initialized and ready.');
    }

    const requireAmmo = shouldLoadAmmoPhysics(wasmAvailable);
    try {
        const physicsWorld = await initPhysics({ requireAmmo });
        app.physicsWorld = physicsWorld;
        app.physics.world = physicsWorld;
        app.physics.getWasmEngine = getWasmEngine;
        app.physics.isWasmAvailable = isWasmAvailable;
        if (requireAmmo) {
            const backend = await import('../dice/AmmoDiceBackend.js');
            backend.bindPhysicsModule(physicsSession);
            setAmmoDiceBackend(backend);
        }
        return { wasmAvailable, physicsWorld };
    } catch (e) {
        console.error('Failed to initialize physics', e);
        showLoadFailure('Error: Physics failed to load. Check console.');
        return null;
    }
}
