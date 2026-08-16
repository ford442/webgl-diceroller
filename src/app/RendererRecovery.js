/**
 * Shadow-refresh throttling, the renderer-identity badge, and GPU
 * context-loss / device-loss recovery. Extracted verbatim from main.js;
 * `renderer` / `composer` / `rendererState` / `rendererBadge` stay owned by
 * main.js and are threaded through as get/set pairs since recovery
 * reassigns them.
 */

import {
    applyRendererSize,
    installRendererRecoveryHandlers,
    recoverRenderer,
    syncComposerPixelRatio,
} from '../core/RendererFactory.js';
import { AppEvent } from '../core/AppEvents.js';

export function createShadowController(getRenderer, sceneRef) {
    const state = {
        externalMotionCount: 0,
        settleStartedAtMs: null,
        staticShadowRefreshes: 0,
        lastReason: 'startup',
        throttleRefresh: false,
        frameCounter: 0,
    };

    const markShadowLightsDirty = () => {
        sceneRef.traverse((child) => {
            if (child.isLight && child.castShadow && child.shadow) {
                child.shadow.needsUpdate = true;
            }
        });
    };

    const enable = (reason = 'motion') => {
        state.lastReason = reason;
        const renderer = getRenderer();
        if (!renderer) return;
        state.frameCounter += 1;
        renderer.shadowMap.autoUpdate = true;
        const shouldRefresh = !state.throttleRefresh || state.frameCounter % 2 === 0;
        if (shouldRefresh) {
            renderer.shadowMap.needsUpdate = true;
            markShadowLightsDirty();
        }
    };

    const requestStaticRefresh = (reason = 'settled') => {
        state.lastReason = reason;
        const renderer = getRenderer();
        if (!renderer) return;
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = true;
        markShadowLightsDirty();
        state.staticShadowRefreshes += 1;
    };

    return {
        state,
        noteMotionStart(reason = 'motion') {
            state.externalMotionCount += 1;
            state.settleStartedAtMs = null;
            enable(reason);
        },
        pulse(reason = 'motion') {
            state.settleStartedAtMs = null;
            enable(reason);
        },
        noteMotionEnd(reason = 'motion') {
            state.externalMotionCount = Math.max(0, state.externalMotionCount - 1);
            state.lastReason = reason;
        },
        forceRefresh(reason = 'manual') {
            requestStaticRefresh(reason);
        },
        setThrottleRefresh(enabled) {
            state.throttleRefresh = enabled;
            if (!enabled) {
                state.frameCounter = 0;
            }
        },
        update(timeMs, diceSettled) {
            const dynamicMotion = state.externalMotionCount > 0 || !diceSettled;
            if (dynamicMotion) {
                state.settleStartedAtMs = null;
                enable('dynamic');
                return;
            }

            if (state.settleStartedAtMs === null) {
                state.settleStartedAtMs = timeMs;
                return;
            }

            if (timeMs - state.settleStartedAtMs >= 500 && getRenderer()?.shadowMap.autoUpdate) {
                requestStaticRefresh('settled');
            }
        },
    };
}

// Small, unobtrusive indicator of the active renderer. Shown when ?debug is on,
// when ?renderer-info is requested, or whenever WebGPU fell back to WebGL so the
// user understands they're on the degraded baseline path. In the happy WebGPU
// case (no debug) nothing is shown, keeping the UI clean.
/**
 * @param {import('../types/app').RendererState | undefined} state
 * @param {{ persistent?: boolean }} [options]
 * @param {() => void} onRemoved called whenever the badge clears itself (fade-out or explicit remove)
 */
export function createRendererBadge(state, { persistent } = {}, onRemoved = () => {}) {
    const container = document.getElementById('canvas-container') || document.body;
    const badge = document.createElement('div');
    badge.style.position = 'absolute';
    badge.style.bottom = '10px';
    badge.style.left = '10px';
    badge.style.fontFamily = 'monospace';
    badge.style.fontSize = '11px';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '5px';
    badge.style.zIndex = '1100';
    badge.style.pointerEvents = 'none';
    badge.style.transition = 'opacity 0.6s ease, background-color 0.3s ease';
    badge.style.maxWidth = 'min(90vw, 420px)';
    badge.style.lineHeight = '1.35';
    container.appendChild(badge);

    const fadeTimers = [];

    function applyState(
        nextState,
        /** @type {{ status?: string; message?: string }} */ options = {}
    ) {
        const { status, message } = options;
        const isFallback = Boolean(nextState?.fallbackReason);
        const type = nextState?.rendererType ?? 'webgl';
        const contextLost = nextState?.contextStatus === 'lost' || status === 'lost';
        const recovering = status === 'recovering';

        if (contextLost) {
            badge.textContent = `GPU context lost${message ? `: ${message}` : ''}`;
            badge.title = message ?? nextState?.contextMessage ?? '';
            badge.style.backgroundColor = 'rgba(140, 20, 20, 0.85)';
            badge.style.color = '#ffd0d0';
            badge.style.opacity = '1';
            return;
        }

        if (recovering) {
            badge.textContent = message ?? 'Recovering renderer…';
            badge.title = '';
            badge.style.backgroundColor = 'rgba(90, 70, 0, 0.8)';
            badge.style.color = '#ffe8a8';
            badge.style.opacity = '1';
            return;
        }

        const prLabel =
            nextState?.pixelRatio != null ? ` · ${nextState.pixelRatio.toFixed(2)}x` : '';
        badge.textContent = isFallback
            ? `renderer: ${type} (fallback)${prLabel}`
            : `renderer: ${type}${prLabel}`;
        badge.title = nextState?.fallbackReason ?? '';
        badge.style.backgroundColor = isFallback ? 'rgba(120, 40, 0, 0.7)' : 'rgba(0, 0, 0, 0.55)';
        badge.style.color = isFallback ? '#ffd9b0' : '#bfe8ff';
        badge.style.opacity = '1';
    }

    applyState(state);

    function scheduleFadeOut() {
        if (persistent) return;
        fadeTimers.push(
            setTimeout(() => {
                badge.style.opacity = '0';
            }, 4000)
        );
        fadeTimers.push(
            setTimeout(() => {
                badge.remove();
                onRemoved?.();
            }, 4800)
        );
    }

    if (!persistent && !state?.fallbackReason && state?.contextStatus !== 'lost') {
        scheduleFadeOut();
    }

    return {
        el: badge,
        update(nextState, options) {
            for (const id of fadeTimers) clearTimeout(id);
            fadeTimers.length = 0;
            applyState(nextState, options);
        },
        remove() {
            for (const id of fadeTimers) clearTimeout(id);
            badge.remove();
            onRemoved?.();
        },
    };
}

/**
 * @param {HTMLElement} container
 * @param {object} deps
 */
export function applyLivePixelRatio(container, nextRatio, deps) {
    const { getRenderer, getComposer, getRendererState, getPostConfig, getRendererBadgeApi } = deps;
    const renderer = getRenderer();
    if (!renderer || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    applyRendererSize(renderer, width, height, nextRatio);
    const rendererState = getRendererState();
    rendererState.pixelRatio = nextRatio;
    rendererState.usePostAA = !rendererState.antialias && nextRatio > 1;
    const postConfig = getPostConfig();
    if (postConfig) {
        postConfig.fxaaEnabled = rendererState.usePostAA && postConfig.quality !== 'off';
    }
    syncComposerPixelRatio(getComposer(), width, height, nextRatio);
    getRendererBadgeApi()?.update(rendererState);
}

/**
 * @param {HTMLElement} container
 * @param {object} deps
 */
export function setupRendererRecovery(container, deps) {
    const {
        app,
        scene,
        appEvents,
        getRenderer,
        setRenderer,
        getComposer,
        setComposer,
        getRendererState,
        setRendererState,
        getRendererBadgeApi,
        setRendererBadge,
        getPostConfig,
    } = deps;

    deps.rendererRecoveryCleanup?.();

    const cleanup = installRendererRecoveryHandlers(getRendererState(), {
        onContextLost: (state, message) => {
            appEvents.emit(AppEvent.RENDERER_LOST, { reason: message ?? 'contextlost', state });
            if (!getRendererBadgeApi()) {
                setRendererBadge(
                    createRendererBadge(state, { persistent: true }, () => setRendererBadge(null))
                );
            } else {
                getRendererBadgeApi()?.update(state, { status: 'lost', message });
            }
        },
        onContextRestored: (state) => {
            getRendererBadgeApi()?.update(state);
            applyLivePixelRatio(container, state.pixelRatio, deps);
        },
        onDeviceLost: async (state, info) => {
            const message = info?.message ?? 'GPU device lost';
            appEvents.emit(AppEvent.RENDERER_LOST, { reason: message, state, info });
            if (!getRendererBadgeApi()) {
                setRendererBadge(
                    createRendererBadge(state, { persistent: true }, () => setRendererBadge(null))
                );
            } else {
                getRendererBadgeApi()?.update(state, { status: 'lost', message });
            }

            if (state._recovering) return;
            state._recovering = true;
            getRendererBadgeApi()?.update(state, {
                status: 'recovering',
                message: 'Recovering via WebGL fallback…',
            });

            try {
                const oldRenderer = getRenderer();
                const oldCanvas = oldRenderer.domElement;
                oldRenderer.setAnimationLoop(null);
                const nextState = await recoverRenderer(container, state);
                oldCanvas?.remove();

                setRenderer(nextState.renderer);
                setRendererState(nextState);
                scene.userData.renderer = nextState.renderer;
                scene.userData.rendererState = nextState;
                scene.userData.rendererType = nextState.rendererType;
                app.renderer = nextState.renderer;
                app.rendererType = nextState.rendererType;
                app.usingWebGPU = nextState?.usingWebGPU === true;
                app.usingWebGL = nextState?.usingWebGL !== false;
                app.rendererFallbackReason = nextState?.fallbackReason ?? null;

                container.appendChild(nextState.renderer.domElement);
                if (deps.animate) nextState.renderer.setAnimationLoop(deps.animate);
                applyLivePixelRatio(container, nextState.pixelRatio, deps);

                const composer = getComposer();
                if (composer?.type === 'webgpu-post') {
                    composer.dispose?.();
                    setComposer(null);
                    const postConfig = getPostConfig();
                    postConfig.quality = 'low';
                    postConfig.fxaaEnabled = false;
                    postConfig.chromaticAberrationEnabled = false;
                }

                deps.onRecovered?.(nextState);
                setupRendererRecovery(container, deps);
                getRendererBadgeApi()?.update(getRendererState());
                console.warn('[Renderer] Recovered from GPU loss via WebGL fallback.');
            } catch (error) {
                console.error('[Renderer] Recovery failed:', error);
                getRendererBadgeApi()?.update(getRendererState(), {
                    status: 'lost',
                    message: `${message} — reload page`,
                });
            } finally {
                state._recovering = false;
            }
        },
    });
    deps.rendererRecoveryCleanup = cleanup;
}
