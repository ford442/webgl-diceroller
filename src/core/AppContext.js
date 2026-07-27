/**
 * Single mutable app context filled during main.js init.
 * Features take services from this object or subscribe via `events`.
 */

import { createAppEvents } from './AppEvents.js';

/**
 * @param {{ events?: import('../types/app').AppEvents }} [options]
 * @returns {import('../types/app').AppContext}
 */
export function createAppContext(options = {}) {
    const events = options.events ?? createAppEvents();

    /** @type {import('../types/app').AppContext} */
    const app = {
        events,
        ready: false,
        scene: null,
        camera: null,
        renderer: null,
        THREE: null,
        scheduler: null,
        physicsWorld: null,
        physics: {
            world: null,
            getWasmEngine: null,
            isWasmAvailable: null,
        },
        dice: {
            replayRoll: null,
            readAllDiceValues: null,
            areDiceSettled: null,
            getDiceValueDebugSnapshot: null,
            rollNotation: null,
        },
        interaction: null,
        audio: null,
        rollSession: null,
        ui: null,
        interactables: Object.create(null),
        PropRegistry: null,
        qualityProfile: null,
        postConfig: null,
        rendererType: null,
        usingWebGPU: false,
        usingWebGL: true,
        rendererFallbackReason: null,
        touchInputEnabled: false,
        isTouchPrimaryDevice: false,
        stats: null,
        tierRenderStats: null,
        fairnessMonitor: null,
        rollHistory: null,
        rollStats: null,
        multiplayer: null,
        xr: null,
        // Filled by install / late bind for flat-shim parity
        forceShadowRefresh: null,
        resetFairnessMonitor: null,
        rerollTableLayout: null,
        getTableLayoutConfig: null,
        getLastRollShareUrl: null,
        getDiceAppearanceConfig: null,
        getDicePresencePayload: null,
        applyDicePresencePayload: null,
        refreshDiceAppearance: null,
        REPLAY_VERSION: null,
        // Top-level Playwright aliases (filled in main.js)
        replayRoll: null,
        readAllDiceValues: null,
        areDiceSettled: null,
        isWasmAvailable: null,
        getWasmEngine: null,
    };

    return app;
}
