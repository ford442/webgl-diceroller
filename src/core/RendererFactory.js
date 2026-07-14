import * as THREE from 'three';

const DEFAULT_PIXEL_RATIO_CAP = 2;
const FRAME_BUDGET_MS = 32; // ~30 fps — step down when sustained above this
const SLOW_FRAME_STREAK = 90; // ~1.5 s of slow frames before stepping down

function getRendererPreference(searchParams, { forceWebGl = false } = {}) {
    if (forceWebGl || searchParams.has('webgl')) {
        return 'webgl';
    }

    if (searchParams.has('webgpu') || searchParams.has('wgpu')) {
        return 'webgpu';
    }

    // Default to the modern WebGPU path. When the browser lacks `navigator.gpu`
    // or WebGPU init fails, createRenderer() gracefully falls back to WebGL.
    // `?webgl` is the explicit escape hatch to the stable baseline renderer.
    return 'webgpu';
}

/**
 * Resolve the render pixel ratio from URL flags and device DPR.
 * `?pr=1` forces 1.0 (MSAA path); `?pr=N` caps at N (clamped to [0.5, 3]).
 */
export function resolvePixelRatioConfig(searchParams = new URLSearchParams(window.location.search)) {
    const deviceDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    if (searchParams.has('pr')) {
        const forced = Number.parseFloat(searchParams.get('pr'));
        if (Number.isFinite(forced) && forced > 0) {
            const clamped = Math.min(Math.max(forced, 0.5), 3);
            return {
                pixelRatio: clamped,
                forced: true,
                cap: clamped,
                deviceDpr
            };
        }
    }

    const cap = Math.min(deviceDpr, DEFAULT_PIXEL_RATIO_CAP);
    return {
        pixelRatio: cap,
        forced: false,
        cap,
        deviceDpr
    };
}

/** MSAA is cheap at DPR 1; at higher DPR rely on post FXAA instead. */
export function resolveAntialias(pixelRatio) {
    return pixelRatio <= 1.0;
}

/**
 * Probe for software rasterizers (SwiftShader, llvmpipe, etc.) where we should
 * auto-apply the low-post profile. Uses failIfMajorPerformanceCaveat plus the
 * unmasked renderer string when available.
 */
export function detectSoftwareWebGL() {
    if (typeof document === 'undefined') return false;

    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl', {
            failIfMajorPerformanceCaveat: true,
            powerPreference: 'high-performance'
        });

        if (!gl) {
            return true;
        }

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
            if (/swiftshader|llvmpipe|software|mesa.*soft|virgl|lavapipe/i.test(renderer)) {
                return true;
            }
        }

        const loseContext = gl.getExtension('WEBGL_lose_context');
        loseContext?.loseContext();
        return false;
    } catch {
        return false;
    }
}

export function applyRendererSize(renderer, width, height, pixelRatio) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
}

function applySharedRendererConfig(renderer, width, height, pixelRatio) {
    applyRendererSize(renderer, width, height, pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
}

function createWebGlRenderer({
    antialias,
    width,
    height,
    pixelRatio,
    requestedRenderer,
    fallbackReason
}) {
    const renderer = new THREE.WebGLRenderer({
        antialias,
        powerPreference: 'high-performance'
    });
    applySharedRendererConfig(renderer, width, height, pixelRatio);

    return {
        renderer,
        rendererType: 'webgl',
        usingWebGPU: false,
        usingWebGL: true,
        requestedRenderer,
        fallbackReason
    };
}

function attachRecoveryHandlers(state, handlers = {}) {
    const { renderer } = state;
    if (!renderer) return () => {};

    const canvas = renderer.domElement;
    const cleanups = [];

    const notifyLost = (message) => {
        state.contextStatus = 'lost';
        state.contextMessage = message;
        handlers.onContextLost?.(state, message);
    };

    const notifyRestored = () => {
        state.contextStatus = 'ok';
        state.contextMessage = null;
        handlers.onContextRestored?.(state);
    };

    if (state.usingWebGPU && typeof renderer.onDeviceLost === 'function') {
        const previous = renderer.onDeviceLost.bind(renderer);
        renderer.onDeviceLost = (info) => {
            previous(info);
            const message = info?.message ?? 'WebGPU device lost';
            notifyLost(message);
            handlers.onDeviceLost?.(state, info);
        };
        cleanups.push(() => {
            renderer.onDeviceLost = previous;
        });
    }

    if (canvas) {
        const onWebGlLost = (event) => {
            event.preventDefault();
            notifyLost(event.statusMessage || 'WebGL context lost');
        };
        const onWebGlRestored = () => {
            notifyRestored();
            const container = canvas.parentElement;
            if (container) {
                applyRendererSize(renderer, container.clientWidth, container.clientHeight, state.pixelRatio);
            }
            renderer.shadowMap.needsUpdate = true;
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

/**
 * Lightweight frame-time monitor that steps pixel ratio down when sustained
 * frame times exceed the budget. Disabled when `?pr=` forces a ratio.
 */
export function createPixelRatioMonitor(rendererState, { onPixelRatioChange, debugPerf = false } = {}) {
    let frameMsSmoothed = 16.7;
    let slowFrameStreak = 0;
    let steppedDown = false;

    function update({ deltaTime = 0 } = {}) {
        if (rendererState.pixelRatioForced || rendererState.pixelRatio <= 1) {
            return;
        }

        const frameMs = deltaTime * 1000;
        if (frameMs <= 0) return;

        frameMsSmoothed += (frameMs - frameMsSmoothed) * 0.08;

        if (frameMsSmoothed > FRAME_BUDGET_MS) {
            slowFrameStreak += 1;
        } else {
            slowFrameStreak = Math.max(0, slowFrameStreak - 2);
        }

        if (slowFrameStreak < SLOW_FRAME_STREAK) return;

        slowFrameStreak = 0;
        const current = rendererState.pixelRatio;
        const next = current <= 1.25 ? 1 : Math.max(1, Math.round((current - 0.5) * 2) / 2);

        if (next >= current) return;

        steppedDown = true;
        rendererState.pixelRatio = next;
        rendererState.usePostAA = !rendererState.antialias && next > 1;
        onPixelRatioChange?.(next);

        if (debugPerf) {
            console.info(`[RendererFactory] Pixel ratio stepped down to ${next} (smoothed ${frameMsSmoothed.toFixed(1)} ms)`);
        }
    }

    return {
        update,
        get steppedDown() { return steppedDown; }
    };
}

export async function createRenderer(container, options = {}) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const searchParams = new URLSearchParams(window.location.search);
    const forceWebGl = Boolean(options.forceWebGl);
    const preferredRenderer = getRendererPreference(searchParams, { forceWebGl });
    const webgpuExplicit = searchParams.has('webgpu') || searchParams.has('wgpu');

    const pixelConfig = resolvePixelRatioConfig(searchParams);
    const pixelRatio = options.pixelRatio ?? pixelConfig.pixelRatio;
    const antialias = options.antialias ?? resolveAntialias(pixelRatio);
    const isSoftwareRenderer = options.isSoftwareRenderer ?? detectSoftwareWebGL();

    const sharedMeta = {
        pixelRatio,
        pixelRatioForced: pixelConfig.forced,
        pixelRatioCap: pixelConfig.cap,
        deviceDpr: pixelConfig.deviceDpr,
        antialias,
        isSoftwareRenderer,
        usePostAA: !antialias && pixelRatio > 1,
        contextStatus: 'ok',
        contextMessage: null
    };

    if (preferredRenderer === 'webgpu') {
        const hasWebGpuApi = typeof navigator !== 'undefined' && Boolean(navigator.gpu);

        if (!hasWebGpuApi) {
            const reason = 'WebGPU unavailable (navigator.gpu missing); using WebGLRenderer.';
            (webgpuExplicit ? console.warn : console.info)(`[RendererFactory] ${reason}`);
            return {
                ...createWebGlRenderer({
                    antialias, width, height, pixelRatio,
                    requestedRenderer: preferredRenderer,
                    fallbackReason: reason
                }),
                ...sharedMeta
            };
        }

        try {
            const THREE_WEBGPU = await import('three/webgpu');
            const renderer = new THREE_WEBGPU.WebGPURenderer({
                antialias,
                powerPreference: 'high-performance'
            });
            applySharedRendererConfig(renderer, width, height, pixelRatio);
            await renderer.init();

            return {
                renderer,
                rendererType: 'webgpu',
                usingWebGPU: true,
                usingWebGL: false,
                requestedRenderer: preferredRenderer,
                fallbackReason: null,
                ...sharedMeta
            };
        } catch (error) {
            const reason = `WebGPU init failed (${error?.message ?? error}); using WebGLRenderer fallback.`;
            console.warn(`[RendererFactory] ${reason}`, error);
            return {
                ...createWebGlRenderer({
                    antialias, width, height, pixelRatio,
                    requestedRenderer: preferredRenderer,
                    fallbackReason: reason
                }),
                ...sharedMeta
            };
        }
    }

    return {
        ...createWebGlRenderer({
            antialias, width, height, pixelRatio,
            requestedRenderer: preferredRenderer,
            fallbackReason: null
        }),
        ...sharedMeta
    };
}

/**
 * Re-create the renderer after an unrecoverable GPU loss. WebGPU failures fall
 * back to the classic WebGLRenderer path.
 */
export async function recoverRenderer(container, priorState) {
    const forceWebGl = priorState?.usingWebGPU === true;
    return createRenderer(container, {
        forceWebGl,
        pixelRatio: priorState?.pixelRatio,
        antialias: priorState?.antialias,
        isSoftwareRenderer: priorState?.isSoftwareRenderer
    });
}

export function installRendererRecoveryHandlers(state, handlers = {}) {
    if (state._recoveryCleanup) {
        state._recoveryCleanup();
    }
    state._recoveryCleanup = attachRecoveryHandlers(state, handlers);
    return state._recoveryCleanup;
}
