/**
 * Tiny typed pub/sub for cross-cutting app signals.
 * Listeners run synchronously; errors are swallowed so one bad subscriber
 * cannot break the frame loop.
 */

import type { AppEvents, AppEventName } from '../types/app';

export type AppEventHandler = (payload: unknown) => void;

export const AppEvent = Object.freeze({
    ROLL_STARTED: 'roll:started',
    ROLL_SETTLED: 'roll:settled',
    DICE_COLLISION: 'dice:collision',
    RENDERER_LOST: 'renderer:lost',
    LAYOUT_REROLLED: 'layout:rerolled',
    APP_READY: 'app:ready',
} as const satisfies Record<string, AppEventName>);

export function createAppEvents(): AppEvents {
    const listeners = new Map<string, Set<AppEventHandler>>();

    function bucket(type: string): Set<AppEventHandler> {
        let set = listeners.get(type);
        if (!set) {
            set = new Set();
            listeners.set(type, set);
        }
        return set;
    }

    function on(type: string, handler: AppEventHandler): () => void {
        if (typeof handler !== 'function') return () => {};
        bucket(type).add(handler);
        return () => off(type, handler);
    }

    function once(type: string, handler: AppEventHandler): () => void {
        const wrap: AppEventHandler = (payload) => {
            off(type, wrap);
            handler(payload);
        };
        return on(type, wrap);
    }

    function off(type: string, handler: AppEventHandler): void {
        listeners.get(type)?.delete(handler);
    }

    function emit(type: string, payload?: unknown): void {
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

    function clear(): void {
        listeners.clear();
    }

    return { on, once, off, emit, clear, AppEvent };
}
