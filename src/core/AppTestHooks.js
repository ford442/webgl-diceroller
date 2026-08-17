/**
 * Installs `window.__app` for Playwright / debug automation.
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

    // Bridge legacy test hook → events (callers that set window.__onDiceCollision).
    app.events.on(app.events.AppEvent.DICE_COLLISION, (ev) => {
        window.__onDiceCollision?.(ev);
    });
}
