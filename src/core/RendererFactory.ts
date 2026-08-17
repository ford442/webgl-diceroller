import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { ComposerLike, RendererState } from '../types/app';

const DEFAULT_PIXEL_RATIO_CAP = 2;
const FRAME_BUDGET_MS = 32; // ~30 fps — step down when sustained above this
const SLOW_FRAME_STREAK = 90; // ~1.5 s of slow frames before stepping down

export type RendererPreference = 'webgl' | 'webgpu';

export interface GetRendererPreferenceOptions {
    forceWebGl?: boolean;
}

export function getRendererPreference(
    searchParams: URLSearchParams,
    { forceWebGl = false }: GetRendererPreferenceOptions = {}
): RendererPreference {
    // WebXR spike requires WebGLRenderer.xr; ignore conflicting ?webgpu/?wgpu.
    if (
        forceWebGl ||
        searchParams.has('webgl') ||
        searchParams.has('xr') ||
        searchParams.has('xr-emulator')
    ) {
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

export interface PixelRatioConfig {
    pixelRatio: number;
    forced: boolean;
    cap: number;
    deviceDpr: number;
}

/**
 * Resolve the render pixel ratio from URL flags and device DPR.
 * `?pr=1` forces 1.0 (MSAA path); `?pr=N` caps at N (clamped to [0.5, 3]).
 */
export function resolvePixelRatioConfig(
    searchParams: URLSearchParams = new URLSearchParams(window.location.search)
): PixelRatioConfig {
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (searchParams.has('pr')) {
        const forced = Number.parseFloat(searchParams.get('pr') ?? '');
        if (Number.isFinite(forced) && forced > 0) {
            const clamped = Math.min(Math.max(forced, 0.5), 3);
            return {
                pixelRatio: clamped,
                forced: true,
                cap: clamped,
                deviceDpr,
            };
        }
    }

    const cap = Math.min(deviceDpr, DEFAULT_PIXEL_RATIO_CAP);
    return {
        pixelRatio: cap,
        forced: false,
        cap,
        deviceDpr,
    };
}

/** MSAA is cheap at DPR 1; at higher DPR rely on post FXAA instead. */
export function resolveAntialias(pixelRatio: number): boolean {
    return pixelRatio <= 1.0;
}

/**
 * Probe for software rasterizers (SwiftShader, llvmpipe, etc.) where we should
 * auto-apply the low-post profile. Uses failIfMajorPerformanceCaveat plus the
 * unmasked renderer string when available.
 */
export function detectSoftwareWebGL(): boolean {
    if (typeof document === 'undefined') return false;

    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl', {
            failIfMajorPerformanceCaveat: true,
            powerPreference: 'high-performance',
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

export function applyRendererSize(
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    width: number,
    height: number,
    pixelRatio: number
): void {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
}

/** Keep WebGL EffectComposer render targets aligned with renderer DPR. */
export function syncComposerPixelRatio(
    composer: ComposerLike | EffectComposer | null | undefined,
    width: number,
    height: number,
    pixelRatio: number
): void {
    if (!composer) return;
    if (typeof composer.setPixelRatio === 'function') {
        composer.setPixelRatio(pixelRatio);
        return;
    }
    composer.setSize?.(width, height);
}

function applySharedRendererConfig(
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    width: number,
    height: number,
    pixelRatio: number
): void {
    applyRendererSize(renderer, width, height, pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const shadowMap = renderer.shadowMap as THREE.WebGLShadowMap;
    shadowMap.autoUpdate = false;
    shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
}

interface WebGlRendererBundle {
    renderer: THREE.WebGLRenderer;
    rendererType: 'webgl';
    usingWebGPU: false;
    usingWebGL: true;
    requestedRenderer: RendererPreference;
    fallbackReason: string | null;
}

function createWebGlRenderer({
    antialias,
    width,
    height,
    pixelRatio,
    requestedRenderer,
    fallbackReason,
}: {
    antialias: boolean;
    width: number;
    height: number;
    pixelRatio: number;
    requestedRenderer: RendererPreference;
    fallbackReason: string | null;
}): WebGlRendererBundle {
    const renderer = new THREE.WebGLRenderer({
        antialias,
        powerPreference: 'high-performance',
    });
    applySharedRendererConfig(renderer, width, height, pixelRatio);

    return {
        renderer,
        rendererType: 'webgl',
        usingWebGPU: false,
        usingWebGL: true,
        requestedRenderer,
        fallbackReason,
    };
}

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

export interface PixelRatioMonitorOptions {
    onPixelRatioChange?: (ratio: number) => void;
    debugPerf?: boolean;
}

export interface PixelRatioMonitor {
    update: (frame?: { deltaTime?: number }) => void;
    readonly steppedDown: boolean;
}

/**
 * Lightweight frame-time monitor that steps pixel ratio down when sustained
 * frame times exceed the budget. Disabled when `?pr=` forces a ratio.
 */
export function createPixelRatioMonitor(
    rendererState: RendererState,
    { onPixelRatioChange, debugPerf = false }: PixelRatioMonitorOptions = {}
): PixelRatioMonitor {
    let frameMsSmoothed = 16.7;
    let slowFrameStreak = 0;
    let steppedDown = false;

    function update({ deltaTime = 0 }: { deltaTime?: number } = {}): void {
        if (rendererState.pixelRatioForced || (rendererState.pixelRatio ?? 1) <= 1) {
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
        const current = rendererState.pixelRatio ?? 1;
        const next = current <= 1.25 ? 1 : Math.max(1, Math.round((current - 0.5) * 2) / 2);

        if (next >= current) return;

        steppedDown = true;
        rendererState.pixelRatio = next;
        rendererState.usePostAA = !rendererState.antialias && next > 1;
        onPixelRatioChange?.(next);

        if (debugPerf) {
            console.info(
                `[RendererFactory] Pixel ratio stepped down to ${next} (smoothed ${frameMsSmoothed.toFixed(1)} ms)`
            );
        }
    }

    return {
        update,
        get steppedDown() {
            return steppedDown;
        },
    };
}

export interface CreateRendererOptions {
    forceWebGl?: boolean;
    pixelRatio?: number;
    antialias?: boolean;
    isSoftwareRenderer?: boolean;
}

export async function createRenderer(
    container: HTMLElement,
    options: CreateRendererOptions = {}
): Promise<RendererState> {
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
        contextStatus: 'ok' as const,
        contextMessage: null as string | null,
    };

    if (preferredRenderer === 'webgpu') {
        const hasWebGpuApi = typeof navigator !== 'undefined' && Boolean(navigator.gpu);

        if (!hasWebGpuApi) {
            const reason = 'WebGPU unavailable (navigator.gpu missing); using WebGLRenderer.';
            (webgpuExplicit ? console.warn : console.info)(`[RendererFactory] ${reason}`);
            return {
                ...createWebGlRenderer({
                    antialias,
                    width,
                    height,
                    pixelRatio,
                    requestedRenderer: preferredRenderer,
                    fallbackReason: reason,
                }),
                ...sharedMeta,
            };
        }

        try {
            const THREE_WEBGPU = await import('three/webgpu');
            const renderer = new THREE_WEBGPU.WebGPURenderer({
                antialias,
                powerPreference: 'high-performance',
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
                ...sharedMeta,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const reason = `WebGPU init failed (${message}); using WebGLRenderer fallback.`;
            console.warn(`[RendererFactory] ${reason}`, error);
            return {
                ...createWebGlRenderer({
                    antialias,
                    width,
                    height,
                    pixelRatio,
                    requestedRenderer: preferredRenderer,
                    fallbackReason: reason,
                }),
                ...sharedMeta,
            };
        }
    }

    return {
        ...createWebGlRenderer({
            antialias,
            width,
            height,
            pixelRatio,
            requestedRenderer: preferredRenderer,
            fallbackReason: null,
        }),
        ...sharedMeta,
    };
}

/**
 * Re-create the renderer after an unrecoverable GPU loss. WebGPU failures fall
 * back to the classic WebGLRenderer path.
 */
export async function recoverRenderer(
    container: HTMLElement,
    priorState?: RendererState | null
): Promise<RendererState> {
    const forceWebGl = priorState?.usingWebGPU === true;
    return createRenderer(container, {
        forceWebGl,
        pixelRatio: priorState?.pixelRatio,
        antialias: priorState?.antialias,
        isSoftwareRenderer: priorState?.isSoftwareRenderer,
    });
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
