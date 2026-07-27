/// <reference types="vite/client" />
// Debug/e2e hooks: under `?test` / `?debug` / `?debug-perf`, main installs
// `window.__app` (stable API) plus deprecated flat `window.*` shims for one release.
// See docs/ARCHITECTURE.md and src/core/AppTestHooks.js.
export {};

declare global {
    interface Window {
        /** Stable test/debug API — only present when `?test` / `?debug` / `?debug-perf`. */
        __app?: import('./types/app').AppContext;

        /** @deprecated Use `window.__app.scene` — removed next release after shim window. */
        scene?: import('three').Scene;
        /** @deprecated Use `window.__app.camera` */
        camera?: import('three').PerspectiveCamera;
        /** @deprecated Use `window.__app.renderer` */
        renderer?: import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer;
        /** @deprecated Use `window.__app.physicsWorld` */
        physicsWorld?: import('./types/ammo').AmmoWorld | null;
        /** @deprecated Use `window.__app.ready` */
        sceneReady?: boolean;
        /** @deprecated Use `window.__app.usingWebGPU` */
        usingWebGPU?: boolean;
        /** @deprecated Use `window.__app.usingWebGL` */
        usingWebGL?: boolean;
        /** @deprecated Use `window.__app.rendererType` */
        rendererType?: 'webgl' | 'webgpu' | string;
        /** @deprecated Use `window.__app.rendererFallbackReason` */
        rendererFallbackReason?: string | null;
        /** @deprecated Use `window.__app.postConfig` */
        postConfig?: import('./types/app').PostConfig;
        /** @deprecated Use `window.__app.qualityProfile` */
        qualityProfile?: unknown;
        /** @deprecated Use `window.__app.stats` */
        __renderStats?: {
            timings?: { render?: number };
            post?: { rendererType?: string };
            shadow?: Record<string, unknown>;
            pixelRatio?: number;
            gameFeel?: unknown;
            culling?: unknown;
        };
        /** @deprecated Use `window.__app.tierRenderStats` */
        __tierRenderStats?: unknown;
        /** @deprecated Use `window.__app.interactables` */
        __interactables?: Record<
            string,
            {
                trigger: () => void;
                getState?: () => Record<string, unknown> & {
                    playCount?: number;
                    draws?: number;
                    lastCard?: unknown;
                    cardCount?: number;
                };
            }
        >;
        /** @deprecated Prefer `window.__app.events.on('dice:collision', …)` */
        __onDiceCollision?: (event: unknown) => void;
        /** @deprecated Use `window.__app.THREE` */
        THREE?: typeof import('three');
        /** @deprecated Use `window.__app.PropRegistry` */
        PropRegistry?: Record<string, unknown>;
        /** @deprecated Use `window.__app.dice.replayRoll` or `__app.replayRoll` via dice bag */
        replayRoll?: (seed?: number | null) => void;
        /** @deprecated Use `window.__app.dice.readAllDiceValues` */
        readAllDiceValues?: () => import('./types/dice').DiceReadValue[];
        /** @deprecated Use `window.__app.dice.areDiceSettled` */
        areDiceSettled?: () => boolean;
        /** @deprecated Use `window.__app.physics.isWasmAvailable` */
        isWasmAvailable?: () => boolean;
        /** @deprecated Use `window.__app.physics.getWasmEngine` */
        getWasmEngine?: () => import('./types/physics').PhysicsEngine;
        forceShadowRefresh?: () => void;
        fairnessMonitor?: unknown;
        rollHistory?: unknown;
        rollStats?: unknown;
        resetFairnessMonitor?: () => void;
        getDiceValueDebugSnapshot?: () => unknown[];
        rollNotation?: (expression: string, seed?: number | null) => Promise<unknown>;
        rerollTableLayout?: (overrides?: unknown) => Promise<unknown>;
        getTableLayoutConfig?: () => unknown;
        getLastRollShareUrl?: () => string | null;
        getDiceAppearanceConfig?: () => unknown;
        getDicePresencePayload?: () => unknown;
        applyDicePresencePayload?: (payload: unknown) => void;
        refreshDiceAppearance?: () => void;
        REPLAY_VERSION?: number;
        /** @deprecated Use `window.__app.touchInputEnabled` */
        touchInputEnabled?: boolean;
        /** @deprecated Use `window.__app.isTouchPrimaryDevice` */
        isTouchPrimaryDevice?: boolean;
        /** @deprecated Safari prefix — prefer AudioContext */
        webkitAudioContext?: typeof AudioContext;
    }
    interface Navigator {
        gpu?: unknown;
    }
}
