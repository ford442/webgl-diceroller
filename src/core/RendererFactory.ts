import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { ComposerLike, RendererState } from '../types/app';
import { isXrRequested } from '../xr/XrFlags.js';

export { isXrRequested, getXrSnapDegrees } from '../xr/XrFlags.js';

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
            alpha: false,
            stencil: false,
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

/**
 * Documented WebGPU device floor. Values sit at or below the spec's guaranteed
 * minima so a conforming adapter succeeds; `requestDevice` reject still falls
 * through to the existing WebGL path.
 */
export const WEBGPU_REQUIRED_LIMITS: Record<string, number> = {
    maxTextureDimension2D: 2048,
    maxBufferSize: 32 * 1024 * 1024,
    maxUniformBufferBindingSize: 16384,
};

export interface WebGlContextAttributeOptions {
    antialias: boolean;
    xrCompatible?: boolean;
}

export interface TavernWebGlContextAttributes {
    alpha: false;
    depth: true;
    stencil: false;
    antialias: boolean;
    premultipliedAlpha: true;
    preserveDrawingBuffer: false;
    powerPreference: 'high-performance';
    failIfMajorPerformanceCaveat: false;
    xrCompatible: boolean;
}

/**
 * Explicit WebGL2 context attributes for the tavern canvas.
 * `xrCompatible` must be set at context creation — Three r181 does not
 * forward it, and Chrome may recreate the context on `requestSession` otherwise.
 */
export function getWebGlContextAttributes({
    antialias,
    xrCompatible = false,
}: WebGlContextAttributeOptions): TavernWebGlContextAttributes {
    return {
        alpha: false,
        depth: true,
        stencil: false,
        antialias,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
        xrCompatible,
    };
}

/** Constructor bag passed to `THREE.WebGLRenderer` (plus `xrCompatible` for tests). */
export function getWebGlRendererParameters(options: WebGlContextAttributeOptions): {
    antialias: boolean;
    alpha: false;
    stencil: false;
    depth: true;
    preserveDrawingBuffer: false;
    powerPreference: 'high-performance';
    xrCompatible: boolean;
} {
    const attrs = getWebGlContextAttributes(options);
    return {
        antialias: Boolean(attrs.antialias),
        alpha: false,
        stencil: false,
        depth: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        xrCompatible: Boolean(attrs.xrCompatible),
    };
}

export function getWebGpuRendererParameters({ antialias }: { antialias: boolean }): {
    antialias: boolean;
    alpha: false;
    stencil: false;
    powerPreference: 'high-performance';
    requiredLimits: Record<string, number>;
} {
    return {
        antialias,
        alpha: false,
        stencil: false,
        powerPreference: 'high-performance',
        requiredLimits: { ...WEBGPU_REQUIRED_LIMITS },
    };
}

/**
 * Compare adapter.limits against {@link WEBGPU_REQUIRED_LIMITS}.
 * Used when `requestDevice` / `WebGPURenderer.init` fails so `?renderer-info`
 * can show which limit was short.
 */
export async function describeWebGpuLimitMismatches(
    requiredLimits: Record<string, number> = WEBGPU_REQUIRED_LIMITS
): Promise<string | null> {
    try {
        const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
        if (!gpu?.requestAdapter) return 'navigator.gpu.requestAdapter missing';
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return 'no WebGPU adapter';
        const parts: string[] = [];
        const limits = adapter.limits as unknown as Record<string, number>;
        for (const [key, need] of Object.entries(requiredLimits)) {
            const have = limits[key];
            if (typeof have === 'number' && have < need) {
                parts.push(`${key}: need ${need}, adapter ${have}`);
            }
        }
        return parts.length > 0 ? parts.join('; ') : null;
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

function applySharedRendererConfig(
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    width: number,
    height: number,
    pixelRatio: number
): void {
    applyRendererSize(renderer, width, height, pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    xrCompatible,
}: {
    antialias: boolean;
    width: number;
    height: number;
    pixelRatio: number;
    requestedRenderer: RendererPreference;
    fallbackReason: string | null;
    xrCompatible: boolean;
}): WebGlRendererBundle {
    const contextAttributes = getWebGlContextAttributes({ antialias, xrCompatible });
    const params = getWebGlRendererParameters({ antialias, xrCompatible });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', contextAttributes);
    if (!context) {
        throw new Error('Unable to create WebGL2 context with tavern attributes');
    }
    const renderer = new THREE.WebGLRenderer({
        canvas,
        context: context as unknown as WebGLRenderingContext,
        antialias: params.antialias,
        alpha: params.alpha,
        stencil: params.stencil,
        depth: params.depth,
        preserveDrawingBuffer: params.preserveDrawingBuffer,
        powerPreference: params.powerPreference,
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
    const xrCompatible = isXrRequested(searchParams);
    const rendererInfo = searchParams.has('renderer-info') || searchParams.has('debug');

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
        xrCompatible,
        gpuLimitNote: null as string | null,
    };

    const webGlArgs = {
        antialias,
        width,
        height,
        pixelRatio,
        requestedRenderer: preferredRenderer,
        xrCompatible,
    };

    if (preferredRenderer === 'webgpu') {
        const hasWebGpuApi = typeof navigator !== 'undefined' && Boolean(navigator.gpu);

        if (!hasWebGpuApi) {
            const reason = 'WebGPU unavailable (navigator.gpu missing); using WebGLRenderer.';
            (webgpuExplicit ? console.warn : console.info)(`[RendererFactory] ${reason}`);
            return {
                ...createWebGlRenderer({
                    ...webGlArgs,
                    fallbackReason: reason,
                }),
                ...sharedMeta,
            };
        }

        try {
            const THREE_WEBGPU = await import('three/webgpu');
            const gpuParams = getWebGpuRendererParameters({ antialias });
            const renderer = new THREE_WEBGPU.WebGPURenderer(gpuParams);
            applySharedRendererConfig(renderer, width, height, pixelRatio);
            await renderer.init();

            if (rendererInfo) {
                console.info(
                    '[RendererFactory] WebGPU requiredLimits floor',
                    WEBGPU_REQUIRED_LIMITS
                );
            }

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
            const gpuLimitNote = await describeWebGpuLimitMismatches();
            const limitSuffix = gpuLimitNote ? `; ${gpuLimitNote}` : '';
            const reason = `WebGPU init failed (${message}${limitSuffix}); using WebGLRenderer fallback.`;
            console.warn(`[RendererFactory] ${reason}`, error);
            if (rendererInfo && gpuLimitNote) {
                console.info('[RendererFactory] WebGPU requiredLimits mismatch:', gpuLimitNote);
            }
            return {
                ...createWebGlRenderer({
                    ...webGlArgs,
                    fallbackReason: reason,
                }),
                ...sharedMeta,
                gpuLimitNote,
            };
        }
    }

    return {
        ...createWebGlRenderer({
            ...webGlArgs,
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
