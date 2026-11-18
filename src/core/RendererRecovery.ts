import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { RendererState } from '../types/app';
import { applyRendererSize } from './PixelRatioPolicy.js';

export interface RendererRecoveryHandlers {
    onContextLost?: (state: RendererState, message: string) => void;
    onContextRestored?: (state: RendererState) => void;
    onDeviceLost?: (state: RendererState, info: unknown) => void;
}

function attachRecoveryHandlers(
    state: RendererState,
    handlers: RendererRecoveryHandlers = {}
): () => void {
    const { renderer } = state;
    if (!renderer) return () => {};

    const canvas = renderer.domElement;
    const cleanups: Array<() => void> = [];

    const notifyLost = (message: string): void => {
        state.contextStatus = 'lost';
        state.contextMessage = message;
        handlers.onContextLost?.(state, message);
    };

    const notifyRestored = (): void => {
        state.contextStatus = 'ok';
        state.contextMessage = null;
        handlers.onContextRestored?.(state);
    };

    if (state.usingWebGPU && typeof (renderer as WebGPURenderer).onDeviceLost === 'function') {
        const webgpuRenderer = renderer as WebGPURenderer & {
            onDeviceLost?: (info: unknown) => void;
            _isDeviceLost?: boolean;
        };
        const previous = webgpuRenderer.onDeviceLost?.bind(webgpuRenderer);
        webgpuRenderer.onDeviceLost = (info: unknown) => {
            const message =
                info && typeof info === 'object' && 'message' in info
                    ? String((info as { message?: string }).message ?? 'WebGPU device lost')
                    : 'WebGPU device lost';
            notifyLost(message);
            handlers.onDeviceLost?.(state, info);
            // Preserve Three.js internal lost-state bookkeeping without surfacing
            // the default console error before our recovery badge runs.
            if (typeof webgpuRenderer._isDeviceLost !== 'undefined') {
                webgpuRenderer._isDeviceLost = true;
            }
        };
        cleanups.push(() => {
            webgpuRenderer.onDeviceLost = previous;
        });
    }

    if (canvas) {
        const onWebGlLost = (event: Event): void => {
            event.preventDefault();
            const statusMessage =
                event instanceof WebGLContextEvent ? event.statusMessage : undefined;
            notifyLost(statusMessage || 'WebGL context lost');
        };
        const onWebGlRestored = (): void => {
            notifyRestored();
            const container = canvas.parentElement;
            if (container) {
                applyRendererSize(
                    renderer,
                    container.clientWidth,
                    container.clientHeight,
                    state.pixelRatio ?? 1
                );
            }
            const shadowMap = renderer.shadowMap as THREE.WebGLShadowMap;
            shadowMap.needsUpdate = true;
        };

        canvas.addEventListener('webglcontextlost', onWebGlLost, false);
        canvas.addEventListener('webglcontextrestored', onWebGlRestored, false);
        cleanups.push(() => {
            canvas.removeEventListener('webglcontextlost', onWebGlLost, false);
            canvas.removeEventListener('webglcontextrestored', onWebGlRestored, false);
        });
    }

    return () => {
        for (const fn of cleanups) fn();
    };
}

export function installRendererRecoveryHandlers(
    state: RendererState,
    handlers: RendererRecoveryHandlers = {}
): () => void {
    if (state._recoveryCleanup) {
        state._recoveryCleanup();
    }
    state._recoveryCleanup = attachRecoveryHandlers(state, handlers);
    return state._recoveryCleanup;
}
