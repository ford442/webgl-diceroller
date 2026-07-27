/**
 * Tiny typed pub/sub for cross-cutting app signals.
 * Listeners run synchronously; errors are swallowed so one bad subscriber
 * cannot break the frame loop.
 */

/** @typedef {(payload: unknown) => void} AppEventHandler */

export const AppEvent = Object.freeze({
    ROLL_STARTED: 'roll:started',
    ROLL_SETTLED: 'roll:settled',
    DICE_COLLISION: 'dice:collision',
    RENDERER_LOST: 'renderer:lost',
    LAYOUT_REROLLED: 'layout:rerolled',
    APP_READY: 'app:ready',
});

/**
 * @returns {import('../types/app').AppEvents}
 */
export function createAppEvents() {
    /** @type {Map<string, Set<AppEventHandler>>} */
    const listeners = new Map();

    /**
     * @param {string} type
     * @returns {Set<AppEventHandler>}
     */
    function bucket(type) {
        let set = listeners.get(type);
        if (!set) {
            set = new Set();
            listeners.set(type, set);
        }
        return set;
    }

    /**
     * @param {string} type
     * @param {AppEventHandler} handler
     * @returns {() => void}
     */
    function on(type, handler) {
        if (typeof handler !== 'function') return () => {};
        bucket(type).add(handler);
        return () => off(type, handler);
    }

    /**
     * @param {string} type
     * @param {AppEventHandler} handler
     * @returns {() => void}
     */
    function once(type, handler) {
        const wrap = /** @type {AppEventHandler} */ (
            (payload) => {
                off(type, wrap);
                handler(payload);
            }
        );
        return on(type, wrap);
    }

    /**
     * @param {string} type
     * @param {AppEventHandler} handler
     */
    function off(type, handler) {
        listeners.get(type)?.delete(handler);
    }

    /**
     * @param {string} type
     * @param {unknown} [payload]
     */
    function emit(type, payload) {
        const set = listeners.get(type);
        if (!set || set.size === 0) return;
        for (const handler of [...set]) {
            try {
                handler(payload);
            } catch (err) {
                console.error(`[AppEvents] listener error for "${type}":`, err);
            }
        }
    }

    function clear() {
        listeners.clear();
    }

    return { on, once, off, emit, clear, AppEvent };
}
