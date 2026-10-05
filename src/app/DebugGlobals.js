/**
 * Stable `window.__app` / `app.*` automation surface consumed by Playwright
 * smoke tests and manual debugging. Installed once, near the end of init(),
 * after the roll session and table layout are ready.
 */

import { isWasmAvailable, getWasmEngine, readSleepDiagnostics } from '../wasm/PhysicsBridge.js';
import {
    decodeSleepDiagnostics,
    summarizeSleepDiagnostics,
} from '../core-engine/wasm/sleepDiagnostics.js';
import { spawnedDice, setForceNoSettle } from '../dice.js';
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
        getActiveDiceSet,
        setDieAppearance,
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
    // "Why is it awake?" — what every settle-timeout harness prints before
    // failing (tests/helpers/browser.js waitForSettle).
    app.physics.getSleepDiagnostics = async () => {
        const engine = isWasmAvailable() ? getWasmEngine() : null;
        const bodies = decodeSleepDiagnostics(await readSleepDiagnostics());
        return {
            engineDieCount: engine?.getDieCount() ?? 0,
            spawnedDice: spawnedDice.length,
            settled: areDiceSettled(),
            bodies,
            summary: summarizeSleepDiagnostics(bodies),
        };
    };
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
    // idle → rolling → settled | timedOut, with counters (RollWiring).
    app.getRollState = () => rollWiring.getRollState();
    app.physics.forceNoSettle = (value = true) => setForceNoSettle(value);
    app.getActiveDiceSet = getActiveDiceSet;
    // Documented for Playwright: patch one die's descriptor entry and the table
    // re-dresses without reloading an asset.
    app.setDieAppearance = (dieKey, patch) => {
        const entry = setDieAppearance(dieKey, patch);
        multiplayerRef.current?.broadcastPresence?.();
        return entry;
    };
    app.getDicePresencePayload = () => buildDicePresencePayload();
    app.applyDicePresencePayload = applyDicePresencePayload;
    app.refreshDiceAppearance = () => {
        refreshDiceAppearance();
        multiplayerRef.current?.broadcastPresence?.();
    };
    app.REPLAY_VERSION = rollWiring.REPLAY_VERSION;
}
