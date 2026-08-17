/// <reference types="vite/client" />
// Debug/e2e hooks: under `?test` / `?debug` / `?debug-perf`, main installs
// `window.__app` (stable API). See docs/ARCHITECTURE.md and src/core/AppTestHooks.js.
export {};

declare global {
    interface Window {
        /** Stable test/debug API — only present when `?test` / `?debug` / `?debug-perf`. */
        __app?: import('./types/app').AppContext;

        /** @deprecated Prefer `window.__app.events.on('dice:collision', …)` */
        __onDiceCollision?: (event: unknown) => void;

        /** @deprecated Safari prefix — prefer AudioContext */
        webkitAudioContext?: typeof AudioContext;
    }
    interface Navigator {
        gpu?: unknown;
    }
}
