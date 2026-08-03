/**
 * Stable `window.__app` / `app.*` automation surface consumed by Playwright
 * smoke tests and manual debugging. Installed once, near the end of init(),
 * after the roll session and table layout are ready.
 */

import { isWasmAvailable, getWasmEngine } from '../wasm/PhysicsBridge.js';
import { AppEvent } from '../core/AppEvents.js';

/**
 * @param {import('../types/app').AppContext} app
 * @param {object} deps
 */
export function installDebugGlobals(app, deps) {
    const {
        appEvents,
        rollWiring,
        getLayoutManager,
        getShadowController,
        rollStats,
        getFairnessMonitor,
        getRollHistoryPanel,
        readAllDiceValues,
        areDiceSettled,
        getDiceValueDebugSnapshot,
        getDiceAppearanceConfig,
        buildDicePresencePayload,
        applyDicePresencePayload,
        refreshDiceAppearance,
        multiplayerRef,
    } = deps;

    app.dice.replayRoll = (seed) => rollWiring.beginRoll(seed);
    app.dice.readAllDiceValues = readAllDiceValues;
    app.dice.areDiceSettled = areDiceSettled;
    app.dice.getDiceValueDebugSnapshot = getDiceValueDebugSnapshot;
    app.dice.rollNotation = (expression, seed = null, options = {}) =>
        rollWiring.rollSessionRef.current?.roll(expression, seed, options);
    // Top-level aliases documented for Playwright.
    app.replayRoll = app.dice.replayRoll;
    app.readAllDiceValues = readAllDiceValues;
    app.areDiceSettled = areDiceSettled;
    app.isWasmAvailable = isWasmAvailable;
    app.getWasmEngine = getWasmEngine;
    app.forceShadowRefresh = () => getShadowController()?.forceRefresh('debug');
    app.resetFairnessMonitor = () => {
        rollStats?.reset();
        getFairnessMonitor()?.render();
        getRollHistoryPanel()?.refresh();
    };
    app.rerollTableLayout = (overrides) => {
        const p = getLayoutManager()?.rerollLayout(overrides);
        return Promise.resolve(p).then((result) => {
            if (result) appEvents.emit(AppEvent.LAYOUT_REROLLED, result);
            return result;
        });
    };
    app.getTableLayoutConfig = () => getLayoutManager()?.getConfig();
    app.getLastRollShareUrl = () => rollWiring.getLastRollShareUrl();
    app.getDiceAppearanceConfig = getDiceAppearanceConfig;
    app.getDicePresencePayload = () => buildDicePresencePayload(getDiceAppearanceConfig());
    app.applyDicePresencePayload = applyDicePresencePayload;
    app.refreshDiceAppearance = () => {
        refreshDiceAppearance();
        multiplayerRef.current?.broadcastPresence?.();
    };
    app.REPLAY_VERSION = rollWiring.REPLAY_VERSION;
}
