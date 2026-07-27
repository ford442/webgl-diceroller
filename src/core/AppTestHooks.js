/**
 * Installs window.__app and deprecated flat window.* shims for Playwright / debug.
 * Call only when ?test, ?debug, or ?debug-perf is present.
 */

let installed = false;

/**
 * @param {import('../types/app').AppContext} app
 */
export function installAppTestHooks(app) {
    if (typeof window === 'undefined' || installed) return;
    installed = true;

    window.__app = app;

    // Live map shared with InteractableRegistry writes.
    window.__interactables = app.interactables;

    const define = (key, getter, setter) => {
        Object.defineProperty(window, key, {
            configurable: true,
            enumerable: true,
            get: getter,
            ...(setter ? { set: setter } : {}),
        });
    };

    define('scene', () => app.scene);
    define('camera', () => app.camera);
    define(
        'renderer',
        () => app.renderer,
        (v) => {
            app.renderer = v;
        }
    );
    define('physicsWorld', () => app.physicsWorld ?? app.physics?.world ?? null);
    define('THREE', () => app.THREE);
    define('sceneReady', () => (app.ready ? true : undefined));
    define('usingWebGPU', () => app.usingWebGPU === true);
    define('usingWebGL', () => app.usingWebGL !== false);
    define('rendererType', () => app.rendererType);
    define('rendererFallbackReason', () => app.rendererFallbackReason ?? null);
    define('postConfig', () => app.postConfig);
    define(
        'qualityProfile',
        () => app.qualityProfile,
        (v) => {
            app.qualityProfile = v;
        }
    );
    define('__renderStats', () => app.stats);
    define('__tierRenderStats', () => app.tierRenderStats);
    define('PropRegistry', () => app.PropRegistry);
    define('fairnessMonitor', () => app.fairnessMonitor);
    define('rollHistory', () => app.rollHistory);
    define('rollStats', () => app.rollStats);
    define('touchInputEnabled', () => app.touchInputEnabled === true);
    define('isTouchPrimaryDevice', () => app.isTouchPrimaryDevice === true);
    define('REPLAY_VERSION', () => app.REPLAY_VERSION);

    window.getWasmEngine = (...args) => app.physics?.getWasmEngine?.(...args);
    window.isWasmAvailable = (...args) => app.physics?.isWasmAvailable?.(...args) ?? false;
    window.forceShadowRefresh = (...args) => app.forceShadowRefresh?.(...args);
    window.replayRoll = (...args) => app.dice?.replayRoll?.(...args);
    window.readAllDiceValues = (...args) => app.dice?.readAllDiceValues?.(...args);
    window.getDiceValueDebugSnapshot = (...args) => app.dice?.getDiceValueDebugSnapshot?.(...args);
    window.areDiceSettled = (...args) => app.dice?.areDiceSettled?.(...args);
    window.rollNotation = (...args) => app.dice?.rollNotation?.(...args);
    window.resetFairnessMonitor = (...args) => app.resetFairnessMonitor?.(...args);
    window.rerollTableLayout = (...args) => app.rerollTableLayout?.(...args);
    window.getTableLayoutConfig = (...args) => app.getTableLayoutConfig?.(...args);
    window.getLastRollShareUrl = (...args) => app.getLastRollShareUrl?.(...args);
    window.getDiceAppearanceConfig = (...args) => app.getDiceAppearanceConfig?.(...args);
    window.getDicePresencePayload = (...args) => app.getDicePresencePayload?.(...args);
    window.applyDicePresencePayload = (...args) => app.applyDicePresencePayload?.(...args);
    window.refreshDiceAppearance = (...args) => app.refreshDiceAppearance?.(...args);

    // Bridge legacy test hook → events (callers that set window.__onDiceCollision).
    app.events.on(app.events.AppEvent.DICE_COLLISION, (ev) => {
        window.__onDiceCollision?.(ev);
    });
}
