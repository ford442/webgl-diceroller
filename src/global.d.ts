/// <reference types="vite/client" />
// Ambient declarations for debug/e2e hooks that main.js attaches to `window`
// (see src/main.js, src/core/LoadingTiers.js, src/interactables/InteractableRegistry.js).
// The Playwright scripts under tests/ and scripts/verify-*.mjs read these from
// the page context, so they're part of the app's real (if informal) contract.
export {};

declare global {
    interface Window {
        scene?: import('three').Scene;
        camera?: import('three').Camera;
        renderer?: any;
        sceneReady?: boolean;
        usingWebGPU?: boolean;
        rendererType?: 'webgl' | 'webgpu';
        rendererFallbackReason?: string | null;
        postConfig?: any;
        __renderStats?: any;
        __interactables?: Record<string, { trigger: () => void; getState?: () => any }>;
    }
    interface Navigator {
        gpu?: unknown;
    }
}
