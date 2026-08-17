/**
 * Interactable registry.
 *
 * A small, central place where interactive props publish a named, programmatic
 * handle to their behaviour. This is what makes the "click the flute / draw a
 * card" interactions discoverable and — importantly — deterministically
 * testable via `app.interactables` (exposed as `window.__app.interactables` under
 * `?test` / `?debug` by AppTestHooks).
 *
 * Handlers shape (all optional except `trigger`):
 *   {
 *     trigger(opts?)   // the primary action (same thing a click does)
 *     getState()       // serialisable snapshot for assertions
 *     ...extra         // prop-specific actions (e.g. flip, draw)
 *   }
 */
const registry = new Map();

/** @type {Record<string, unknown> | null} */
let mirrorTarget = null;

/**
 * Bind the live object that receives register/unregister mirrors (typically
 * `app.interactables`). Pass null to disable mirroring.
 * @param {Record<string, unknown> | null} target
 */
export function setInteractablesMirror(target) {
    mirrorTarget = target;
    if (!target) return;
    for (const [name, handlers] of registry) {
        target[name] = handlers;
    }
}

export function registerInteractable(name, handlers) {
    if (!name || !handlers) return;
    registry.set(name, handlers);
    if (mirrorTarget) mirrorTarget[name] = handlers;
}

export function unregisterInteractable(name) {
    registry.delete(name);
    if (mirrorTarget) delete mirrorTarget[name];
}

export function getInteractable(name) {
    return registry.get(name) ?? null;
}

export function listInteractables() {
    return [...registry.keys()];
}
