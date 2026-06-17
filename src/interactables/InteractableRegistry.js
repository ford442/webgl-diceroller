/**
 * Interactable registry.
 *
 * A small, central place where interactive props publish a named, programmatic
 * handle to their behaviour. This is what makes the "click the flute / draw a
 * card" interactions discoverable and — importantly — deterministically
 * testable: each handle is mirrored onto `window.__interactables[name]` so
 * Playwright (or the console) can trigger an action without simulating a 3D
 * raycast click through software-GL.
 *
 * Handlers shape (all optional except `trigger`):
 *   {
 *     trigger(opts?)   // the primary action (same thing a click does)
 *     getState()       // serialisable snapshot for assertions
 *     ...extra         // prop-specific actions (e.g. flip, draw)
 *   }
 */
const registry = new Map();

function ensureWindowMap() {
    if (typeof window === 'undefined') return null;
    if (!window.__interactables) window.__interactables = {};
    return window.__interactables;
}

export function registerInteractable(name, handlers) {
    if (!name || !handlers) return;
    registry.set(name, handlers);
    const map = ensureWindowMap();
    if (map) map[name] = handlers;
}

export function unregisterInteractable(name) {
    registry.delete(name);
    const map = ensureWindowMap();
    if (map) delete map[name];
}

export function getInteractable(name) {
    return registry.get(name) ?? null;
}

export function listInteractables() {
    return [...registry.keys()];
}
