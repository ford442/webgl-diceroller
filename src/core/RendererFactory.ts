import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { ComposerLike, RendererState } from '../types/app';
import {
    getDeviceSession,
    resolvePowerPreference,
    type DeviceSession,
    type GlPowerPreference,
    type RendererPreference,
} from './DeviceSession.js';
import {
    CONTEXT_PROFILES,
    getForcedContextProfileId,
    resolveProfileAntialias,
    resolveProfilePostAA,
    resolveProfilePowerPreference,
    selectContextProfile,
    type ContextProfile,
    type ContextProfileSelection,
    type ContextShadows,
} from './ContextProfile.js';

export { isXrRequested, getXrSnapDegrees } from '../xr/XrFlags.js';
export { getRendererPreference } from './DeviceSession.js';
export type { GetRendererPreferenceOptions, RendererPreference } from './DeviceSession.js';

const DEFAULT_PIXEL_RATIO_CAP = 2;
const FRAME_BUDGET_MS = 32; // ~30 fps — step down when sustained above this
const SLOW_FRAME_STREAK = 90; // ~1.5 s of slow frames before stepping down

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

/** MSAA is cheap at DPR 1; at higher DPR rely on post FXAA instead (the desktop profile rule). */
export function resolveAntialias(pixelRatio: number): boolean {
    return resolveProfileAntialias(CONTEXT_PROFILES.desktop, pixelRatio);
}

/** Renderer / adapter strings that identify a software rasterizer. */
const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|software|mesa.*soft|virgl|lavapipe/i;

export function isSoftwareRendererString(value: string | null | undefined): boolean {
    return Boolean(value) && SOFTWARE_RENDERER_PATTERN.test(value as string);
}

export interface SoftwareProbeResult {
    isSoftware: boolean;
    /** Unmasked WebGL2 renderer string, when the debug extension exposes it. */
    renderer: string | null;
    /** How the probe's context was released before returning. */
    released: 'event' | 'timeout' | 'none';
}

export interface ProbeSoftwareWebGlOptions {
    /** Upper bound on waiting for `webglcontextlost` after `loseContext()`. */
    timeoutMs?: number;
    doc?: Pick<Document, 'createElement'>;
}

/** Context attributes for the probe: a detector, not the renderer. */
export const SOFTWARE_PROBE_CONTEXT_ATTRIBUTES = {
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: true,
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
} as const;

/**
 * Probe for software rasterizers (SwiftShader, llvmpipe, etc.) where we should
 * auto-apply the low-post profile. Uses failIfMajorPerformanceCaveat plus the
 * unmasked renderer string when available.
 *
 * Only run on the WebGL path — WebGPU reads the same answer off its adapter.
 * The probe asks for `low-power` WebGL2 (so the renderer string matches the
 * context the tavern keeps) on a canvas that is never attached, and resolves
 * only once that context is lost (or `timeoutMs` passes): `loseContext()` is
 * asynchronous, and on Intel / SwiftShader / Quest a still-live probe context
 * can hold the slot the tavern context is about to ask for.
 */
export async function probeSoftwareWebGL({
    timeoutMs = 250,
    doc = typeof document !== 'undefined' ? document : undefined,
}: ProbeSoftwareWebGlOptions = {}): Promise<SoftwareProbeResult> {
    if (!doc) return { isSoftware: false, renderer: null, released: 'none' };

    let canvas: HTMLCanvasElement | null = null;
    try {
        canvas = doc.createElement('canvas');
        const gl = canvas.getContext(
            'webgl2',
            SOFTWARE_PROBE_CONTEXT_ATTRIBUTES
        ) as WebGL2RenderingContext | null;
        if (!gl) {
            // failIfMajorPerformanceCaveat refused (or no WebGL2 at all).
            return { isSoftware: true, renderer: null, released: 'none' };
        }

        let renderer: string | null = null;
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '') || null;
        }
        const isSoftware = isSoftwareRendererString(renderer);

        const loseContext = gl.getExtension('WEBGL_lose_context');
        if (!loseContext) {
            return { isSoftware, renderer, released: 'none' };
        }
        const probeCanvas = canvas;
        const released = await new Promise<'event' | 'timeout'>((resolve) => {
            const timer = setTimeout(() => {
                probeCanvas.removeEventListener('webglcontextlost', onLost);
                resolve('timeout');
            }, timeoutMs);
            // No preventDefault(): the probe never wants its context restored.
            function onLost(): void {
                clearTimeout(timer);
                probeCanvas.removeEventListener('webglcontextlost', onLost);
                resolve('event');
            }
            probeCanvas.addEventListener('webglcontextlost', onLost);
            loseContext.loseContext();
        });
        return { isSoftware, renderer, released };
    } catch {
        return { isSoftware: false, renderer: null, released: 'none' };
    } finally {
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
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

/**
 * WebGPU device feature floor. Deliberately empty beyond the perf-tracking
 * opt-in below: none of the TSL materials this app ships depend on an
 * optional GPU feature today. Passing a curated (rather than absent)
 * `requiredFeatures` list stops Three's `WebGPUBackend.init()` from doing
 * what it does when `parameters.device` is left unset — enumerating every
 * `GPUFeatureName` the adapter reports and requesting all of them — which
 * makes the adapter's full feature set part of this app's de facto support
 * matrix (and its replay/determinism surface) without that ever being a
 * deliberate choice. If a material starts needing e.g.
 * `float32-filterable`, add it here with a comment saying which material
 * needs it, not silently — see docs/RENDERER.md (if this list grows).
 */
export const WEBGPU_CURATED_FEATURES: readonly string[] = [];

/** GPU feature name gating `WebGPURenderer`'s `trackTimestamp` (GPU pass timing). */
export const WEBGPU_TIMESTAMP_QUERY_FEATURE = 'timestamp-query';

/** `?debug-perf` / `?gpu-timer` opt into GPU-timestamp pass timing (see createRenderer). */
export function wantsWebGpuTimestampQuery(searchParams: URLSearchParams): boolean {
    return searchParams.has('debug-perf') || searchParams.has('gpu-timer');
}

/**
 * Curated `requiredFeatures` for `adapter.requestDevice()`: the documented
 * floor (currently empty) plus `timestamp-query` when both the caller wants
 * GPU-timestamp tracking and the adapter actually supports it. Never
 * requests a feature the adapter lacks — `requestDevice` rejects on an
 * unsupported required feature, and that would turn "no GPU timer" into
 * "no WebGPU at all".
 */
export function getWebGpuRequiredFeatures(
    adapterFeatures: { has(name: string): boolean },
    { wantTimestampQuery }: { wantTimestampQuery: boolean }
): string[] {
    const features = [...WEBGPU_CURATED_FEATURES];
    if (wantTimestampQuery && adapterFeatures.has(WEBGPU_TIMESTAMP_QUERY_FEATURE)) {
        features.push(WEBGPU_TIMESTAMP_QUERY_FEATURE);
    }
    return features;
}

export interface WebGlContextAttributeOptions {
    antialias: boolean;
    xrCompatible?: boolean;
    powerPreference?: GlPowerPreference;
    /** Opaque tavern by default; a transparent profile (preview, #315 overlay) flips it. */
    alpha?: boolean;
}

export interface TavernWebGlContextAttributes {
    alpha: boolean;
    depth: true;
    stencil: false;
    antialias: boolean;
    premultipliedAlpha: true;
    preserveDrawingBuffer: false;
    powerPreference: GlPowerPreference;
    failIfMajorPerformanceCaveat: false;
    xrCompatible: boolean;
}

/**
 * The single WebGL attribute bag. Every app context (tavern, dice-case preview,
 * future overlay) derives from this so the list cannot drift between copies.
 * `xrCompatible` must be set at context creation — Three r181 does not
 * forward it, and Chrome may recreate the context on `requestSession` otherwise.
 * Never add `desynchronized: true` without a screenshot test (fights capturePng()).
 */
export function getWebGlContextAttributes({
    antialias,
    xrCompatible = false,
    powerPreference = 'high-performance',
    alpha = false,
}: WebGlContextAttributeOptions): TavernWebGlContextAttributes {
    return {
        alpha,
        depth: true,
        stencil: false,
        antialias,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference,
        failIfMajorPerformanceCaveat: false,
        xrCompatible,
    };
}

/** Constructor bag passed to `THREE.WebGLRenderer` (plus `xrCompatible` for tests). */
export function getWebGlRendererParameters(options: WebGlContextAttributeOptions): {
    antialias: boolean;
    alpha: boolean;
    stencil: false;
    depth: true;
    preserveDrawingBuffer: false;
    powerPreference: GlPowerPreference;
    xrCompatible: boolean;
} {
    const {
        antialias,
        alpha,
        stencil,
        depth,
        preserveDrawingBuffer,
        powerPreference,
        xrCompatible,
    } = getWebGlContextAttributes(options);
    return {
        antialias,
        alpha,
        stencil,
        depth,
        preserveDrawingBuffer,
        powerPreference,
        xrCompatible,
    };
}

/**
 * The attribute-helper options a {@link ContextProfile} implies. `pixelRatio`
 * resolves `msaa-at-pr1`; `sessionPowerPreference` is what the DeviceSession
 * (plus the software probe) settled on — the profile can only lower it.
 */
export function getProfileContextOptions(
    profile: ContextProfile,
    {
        pixelRatio = 1,
        sessionPowerPreference = profile.powerPreference,
    }: { pixelRatio?: number; sessionPowerPreference?: GlPowerPreference } = {}
): Required<WebGlContextAttributeOptions> {
    return {
        antialias: resolveProfileAntialias(profile, pixelRatio),
        alpha: profile.alpha,
        powerPreference: resolveProfilePowerPreference(profile, sessionPowerPreference),
        xrCompatible: profile.xrCompatible,
    };
}

/**
 * Lazy dice-case preview context: the `preview` row of CONTEXT_PROFILES
 * (transparent, low-power, no MSAA). Browsers cap GL contexts (8–16) and
 * Intel / SwiftShader / Quest hit that first, so a secondary canvas never asks
 * for the high-performance slot.
 */
export const PREVIEW_WEBGL_CONTEXT: Readonly<Required<WebGlContextAttributeOptions>> =
    Object.freeze(getProfileContextOptions(CONTEXT_PROFILES.preview));

export function getWebGpuRendererParameters({
    antialias,
    powerPreference = 'high-performance',
    alpha = false,
}: {
    antialias: boolean;
    powerPreference?: GlPowerPreference;
    alpha?: boolean;
}): {
    antialias: boolean;
    alpha: boolean;
    stencil: false;
    powerPreference: GlPowerPreference;
    requiredLimits: Record<string, number>;
} {
    return {
        antialias,
        alpha,
        stencil: false,
        powerPreference,
        requiredLimits: { ...WEBGPU_REQUIRED_LIMITS },
    };
}

/**
 * Compare adapter limits against {@link WEBGPU_REQUIRED_LIMITS}. Pure — callers
 * pass the limits of the adapter they already requested, so a failure path never
 * needs a second `requestAdapter` round-trip just to explain itself.
 */
export function describeLimitMismatches(
    adapterLimits: Record<string, number> | null | undefined,
    requiredLimits: Record<string, number> = WEBGPU_REQUIRED_LIMITS
): string | null {
    if (!adapterLimits) return null;
    const parts: string[] = [];
    for (const [key, need] of Object.entries(requiredLimits)) {
        const have = adapterLimits[key];
        if (typeof have === 'number' && have < need) {
            parts.push(`${key}: need ${need}, adapter ${have}`);
        }
    }
    return parts.length > 0 ? parts.join('; ') : null;
}

export interface CuratedWebGpuDevice {
    device: unknown;
    trackTimestamp: boolean;
    requiredFeatures: string[];
    adapterLimits: Record<string, number> | null;
    /** From `adapter.info` — replaces the WebGL software probe on the WebGPU path. */
    isSoftware: boolean;
    /** Human-readable adapter identity for `?renderer-info` (null when unreported). */
    adapterDescription?: string | null;
}

export interface CuratedWebGpuFailure {
    device: null;
    reason: string;
    limitNote: string | null;
    /** Set when the adapter was refused for being a software / fallback adapter. */
    softwareAdapter?: boolean;
    adapterDescription?: string | null;
}

interface AdapterInfoLike {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
    isFallbackAdapter?: boolean;
}

/** Software / fallback adapter (SwiftShader-Vulkan, lavapipe, WARP fallback). */
export function isSoftwareWebGpuAdapter(
    info: AdapterInfoLike | null | undefined,
    isFallbackAdapter = false
): boolean {
    if (isFallbackAdapter || info?.isFallbackAdapter) return true;
    if (!info) return false;
    return isSoftwareRendererString(
        [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ')
    );
}

/** `vendor architecture device description`, deduplicated; null when the adapter reports nothing. */
export function describeWebGpuAdapter(
    info: AdapterInfoLike | null | undefined,
    isFallbackAdapter = false
): string | null {
    const parts = [info?.vendor, info?.architecture, info?.device, info?.description]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter((part, index, all) => part.length > 0 && all.indexOf(part) === index);
    const fallback = isFallbackAdapter || info?.isFallbackAdapter ? ' (fallback adapter)' : '';
    return parts.length > 0 || fallback ? `${parts.join(' ') || 'unknown'}${fallback}` : null;
}

export interface RequestCuratedWebGpuDeviceOptions {
    powerPreference?: GlPowerPreference;
    /**
     * Refuse a software / fallback adapter (SwiftShader-Vulkan, lavapipe, WARP)
     * before any device exists, so the caller can take the classic WebGL path.
     * WebGPU on those adapters either fails mid-init or lands on Three's WebGL2
     * TSL backend, which never finishes loading under SwiftShader.
     */
    rejectSoftwareAdapter?: boolean;
}

/**
 * Request a WebGPU device with {@link getWebGpuRequiredFeatures}'s curated
 * feature list instead of letting `WebGPUBackend.init()` request every
 * `GPUFeatureName` the adapter reports (see WEBGPU_CURATED_FEATURES). The
 * resulting `device` is meant to be passed into `WebGPURenderer`'s
 * constructor — `WebGPUBackend.init()` uses a caller-supplied `device`
 * as-is and skips its own (kitchen-sink) adapter/device request entirely.
 *
 * Makes exactly one `requestAdapter` call. Returns `null` when
 * `navigator.gpu`/`requestAdapter` is unavailable, or a `{ device: null }`
 * failure (with the limit note from that same adapter) when there is no
 * adapter or `requestDevice` rejects. Callers must treat either as a WebGL
 * fallback — never construct `WebGPURenderer` without a curated device.
 */
export async function requestCuratedWebGpuDevice(
    wantTimestampQuery: boolean,
    {
        powerPreference = 'high-performance',
        rejectSoftwareAdapter = false,
    }: RequestCuratedWebGpuDeviceOptions = {}
): Promise<CuratedWebGpuDevice | CuratedWebGpuFailure | null> {
    // Cast locally rather than relying on the ambient `Navigator.gpu`
    // augmentation (src/global.d.ts) — under tsconfig.strict.json's
    // broader lib/type set that augmentation resolves through a
    // fragile @types/node conditional type and loses its shape.
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const gpu = (nav as { gpu?: { requestAdapter(opts?: unknown): Promise<unknown> } })?.gpu;
    if (!gpu?.requestAdapter) return null;

    type AdapterLike = {
        features: { has(name: string): boolean };
        limits: unknown;
        info?: AdapterInfoLike;
        isFallbackAdapter?: boolean;
        requestDevice(descriptor?: {
            requiredFeatures?: string[];
            requiredLimits?: Record<string, number>;
        }): Promise<unknown>;
    };
    let adapter: AdapterLike | null;
    try {
        adapter = (await gpu.requestAdapter({ powerPreference })) as AdapterLike | null;
    } catch (err) {
        return {
            device: null,
            reason: `requestAdapter threw: ${errorMessage(err)}`,
            limitNote: null,
        };
    }
    if (!adapter) return { device: null, reason: 'no WebGPU adapter', limitNote: null };

    const isFallbackAdapter = adapter.isFallbackAdapter === true;
    const isSoftware = isSoftwareWebGpuAdapter(adapter.info, isFallbackAdapter);
    const adapterDescription = describeWebGpuAdapter(adapter.info, isFallbackAdapter);
    if (isSoftware && rejectSoftwareAdapter) {
        return {
            device: null,
            reason: `software WebGPU adapter${adapterDescription ? ` (${adapterDescription})` : ''}`,
            limitNote: null,
            softwareAdapter: true,
            adapterDescription,
        };
    }

    const adapterLimits = readAdapterLimits(adapter.limits);
    const requiredFeatures = getWebGpuRequiredFeatures(adapter.features, { wantTimestampQuery });
    let device: unknown;
    try {
        device = await adapter.requestDevice({
            requiredFeatures,
            requiredLimits: WEBGPU_REQUIRED_LIMITS,
        });
    } catch (err) {
        return {
            device: null,
            reason: `requestDevice rejected: ${errorMessage(err)}`,
            limitNote: describeLimitMismatches(adapterLimits),
            adapterDescription,
        };
    }
    if (!device) {
        return {
            device: null,
            reason: 'requestDevice returned no device',
            limitNote: describeLimitMismatches(adapterLimits),
            adapterDescription,
        };
    }

    return {
        device,
        trackTimestamp: requiredFeatures.includes(WEBGPU_TIMESTAMP_QUERY_FEATURE),
        requiredFeatures,
        adapterLimits,
        isSoftware,
        adapterDescription,
    };
}

/** GPUSupportedLimits exposes getters on the prototype; copy what we compare. */
function readAdapterLimits(limits: unknown): Record<string, number> | null {
    if (!limits || typeof limits !== 'object') return null;
    const out: Record<string, number> = {};
    for (const key of Object.keys(WEBGPU_REQUIRED_LIMITS)) {
        const value = (limits as Record<string, unknown>)[key];
        if (typeof value === 'number') out[key] = value;
    }
    return out;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

const SHADOW_MAP_TYPES: Record<Exclude<ContextShadows, 'off'>, THREE.ShadowMapType> = {
    'pcf-soft': THREE.PCFSoftShadowMap,
    pcf: THREE.PCFShadowMap,
    basic: THREE.BasicShadowMap,
};

function applySharedRendererConfig(
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    width: number,
    height: number,
    pixelRatio: number,
    { shadows = 'pcf-soft', alpha = false }: { shadows?: ContextShadows; alpha?: boolean } = {}
): void {
    applyRendererSize(renderer, width, height, pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = shadows !== 'off';
    renderer.shadowMap.type = SHADOW_MAP_TYPES[shadows === 'off' ? 'pcf-soft' : shadows];
    // A transparent profile clears to alpha 0 so the page shows through;
    // SceneSetup also drops the opaque scene.background for it.
    if (alpha) renderer.setClearColor(0x000000, 0);
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

export interface WebGlRendererArgs {
    antialias: boolean;
    width: number;
    height: number;
    pixelRatio: number;
    requestedRenderer: RendererPreference;
    fallbackReason: string | null;
    xrCompatible: boolean;
    powerPreference: GlPowerPreference;
    alpha?: boolean;
    shadows?: ContextShadows;
}

function createWebGlRenderer({
    antialias,
    width,
    height,
    pixelRatio,
    requestedRenderer,
    fallbackReason,
    xrCompatible,
    powerPreference,
    alpha = false,
    shadows = 'pcf-soft',
}: WebGlRendererArgs): WebGlRendererBundle {
    const contextAttributes = getWebGlContextAttributes({
        antialias,
        xrCompatible,
        powerPreference,
        alpha,
    });
    const params = getWebGlRendererParameters({ antialias, xrCompatible, powerPreference, alpha });
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
    applySharedRendererConfig(renderer, width, height, pixelRatio, { shadows, alpha });

    return {
        renderer,
        rendererType: 'webgl',
        usingWebGPU: false,
        usingWebGL: true,
        requestedRenderer,
        fallbackReason,
    };
}

export interface WebGpuRendererArgs {
    antialias: boolean;
    width: number;
    height: number;
    pixelRatio: number;
    powerPreference: GlPowerPreference;
    curated: CuratedWebGpuDevice;
    alpha?: boolean;
    shadows?: ContextShadows;
}

async function createWebGpuRenderer({
    antialias,
    width,
    height,
    pixelRatio,
    powerPreference,
    curated,
    alpha = false,
    shadows = 'pcf-soft',
}: WebGpuRendererArgs): Promise<WebGPURenderer> {
    const THREE_WEBGPU = await import('three/webgpu');
    // Own the canvas here rather than letting WebGPURenderer create
    // its own (the WebGL path already creates one first) — recovery,
    // XR, and a second view all need one stable element to hold on to.
    const canvas = document.createElement('canvas');
    const renderer = new THREE_WEBGPU.WebGPURenderer({
        ...getWebGpuRendererParameters({ antialias, powerPreference, alpha }),
        canvas,
        device: curated.device as GPUDevice,
        trackTimestamp: curated.trackTimestamp,
    });
    applySharedRendererConfig(renderer, width, height, pixelRatio, { shadows, alpha });
    await renderer.init();
    return renderer;
}

/** Seams `verify:renderer-factory` stubs; production always uses the defaults. */
export interface RendererDeps {
    probeSoftwareWebGL: () => Promise<SoftwareProbeResult>;
    requestCuratedWebGpuDevice: typeof requestCuratedWebGpuDevice;
    createWebGlRenderer: (args: WebGlRendererArgs) => WebGlRendererBundle;
    createWebGpuRenderer: (args: WebGpuRendererArgs) => Promise<WebGPURenderer>;
}

const DEFAULT_RENDERER_DEPS: RendererDeps = {
    probeSoftwareWebGL: () => probeSoftwareWebGL(),
    requestCuratedWebGpuDevice,
    createWebGlRenderer,
    createWebGpuRenderer,
};

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
    /** Known software-ness (renderer recovery) — skips the WebGL probe. */
    isSoftwareRenderer?: boolean;
    /** Defaults to the memoised boot {@link getDeviceSession}. */
    session?: DeviceSession;
    searchParams?: URLSearchParams;
    deps?: Partial<RendererDeps>;
}

export async function createRenderer(
    container: HTMLElement,
    options: CreateRendererOptions = {}
): Promise<RendererState> {
    const deps: RendererDeps = { ...DEFAULT_RENDERER_DEPS, ...options.deps };
    const width = container.clientWidth;
    const height = container.clientHeight;
    const searchParams = options.searchParams ?? new URLSearchParams(window.location.search);
    const session = options.session ?? getDeviceSession(searchParams);
    const webgpuExplicit = searchParams.has('webgpu') || searchParams.has('wgpu');
    const rendererInfo = searchParams.has('renderer-info') || searchParams.has('debug');

    // A forced classic-WebGL profile (?context=software|preview|xr) never tries
    // WebGPU; ?xr already resolves to 'webgl' in the session.
    const forcedProfileId = getForcedContextProfileId(searchParams);
    const forcedClassic = forcedProfileId
        ? CONTEXT_PROFILES[forcedProfileId].classicWebGlOnly
        : false;
    const preferredRenderer: RendererPreference =
        options.forceWebGl || forcedClassic ? 'webgl' : session.preferredRenderer;

    const pixelConfig = resolvePixelRatioConfig(searchParams);
    const pixelRatio = options.pixelRatio ?? pixelConfig.pixelRatio;

    /** Profile-dependent fields every path reports the same way. */
    const profileMeta = (
        selection: ContextProfileSelection,
        sessionPowerPreference: GlPowerPreference
    ) => {
        const { profile } = selection;
        const contextOptions = getProfileContextOptions(profile, {
            pixelRatio,
            sessionPowerPreference,
        });
        // Recovery re-creates with the prior antialias so MSAA does not flip mid-session.
        const antialias = options.antialias ?? contextOptions.antialias;
        return {
            contextOptions: {
                ...contextOptions,
                antialias,
                xrCompatible: contextOptions.xrCompatible || session.xrCompatible,
            },
            meta: {
                pixelRatio,
                pixelRatioForced: pixelConfig.forced,
                pixelRatioCap: pixelConfig.cap,
                deviceDpr: pixelConfig.deviceDpr,
                antialias,
                usePostAA: resolveProfilePostAA(profile, antialias, pixelRatio),
                contextStatus: 'ok' as const,
                contextMessage: null as string | null,
                xrCompatible: contextOptions.xrCompatible || session.xrCompatible,
                gpuLimitNote: null as string | null,
                contextProfile: profile.id,
                contextProfileReason: selection.reason,
                contextAlpha: profile.alpha,
                contextPost: profile.post,
                contextShadows: profile.shadows,
            },
        };
    };

    /**
     * WebGL path: run the software probe (unless the answer is already known —
     * renderer recovery, or a refused software WebGPU adapter) and wait for its
     * context to be released *before* creating the tavern context, then let a
     * software rasterizer pick the software profile and lower the power preference.
     */
    const buildWebGl = async (
        fallbackReason: string | null,
        {
            gpuLimitNote = null,
            knownSoftware,
            adapterDescription = null,
        }: {
            gpuLimitNote?: string | null;
            knownSoftware?: boolean;
            adapterDescription?: string | null;
        } = {}
    ): Promise<RendererState> => {
        let softwareProbe: SoftwareProbeResult | null = null;
        let isSoftwareRenderer = options.isSoftwareRenderer ?? knownSoftware;
        if (isSoftwareRenderer === undefined) {
            softwareProbe = await deps.probeSoftwareWebGL();
            isSoftwareRenderer = softwareProbe.isSoftware;
        }
        const power = resolvePowerPreference(session, isSoftwareRenderer);
        const selection = selectContextProfile({ searchParams, session, isSoftwareRenderer });
        const { contextOptions, meta } = profileMeta(selection, power.powerPreference);
        if (rendererInfo) {
            console.info('[RendererFactory] WebGL context', {
                profile: selection.profile.id,
                profileReason: selection.reason,
                powerPreference: contextOptions.powerPreference,
                reasons: power.reasons,
                softwareProbe,
            });
        }
        const bundle = deps.createWebGlRenderer({
            antialias: contextOptions.antialias,
            width,
            height,
            pixelRatio,
            requestedRenderer: preferredRenderer,
            fallbackReason,
            xrCompatible: contextOptions.xrCompatible,
            powerPreference: contextOptions.powerPreference,
            alpha: contextOptions.alpha,
            shadows: selection.profile.shadows,
        });
        return {
            ...bundle,
            ...meta,
            isSoftwareRenderer,
            glPowerPreference: contextOptions.powerPreference,
            powerReasons: power.reasons,
            softwareProbe,
            gpuLimitNote,
            sampleCount: readWebGlSampleCount(bundle.renderer),
            adapterDescription: adapterDescription ?? softwareProbe?.renderer ?? null,
        };
    };

    if (preferredRenderer !== 'webgpu') {
        return buildWebGl(null);
    }

    if (!session.hasWebGpuApi) {
        const reason = 'WebGPU unavailable (navigator.gpu missing); using WebGLRenderer.';
        (webgpuExplicit ? console.warn : console.info)(`[RendererFactory] ${reason}`);
        return buildWebGl(reason);
    }

    // WebGPU path: no WebGL probe — the adapter reports software-ness itself.
    // A software / fallback adapter goes straight to classic WebGL unless
    // ?webgpu asked for WebGPU explicitly (that is how you test the adapter).
    const wantTimestampQuery = wantsWebGpuTimestampQuery(searchParams);
    const powerPreference = session.glPowerPreference;
    let curated: CuratedWebGpuDevice | CuratedWebGpuFailure | null = null;
    try {
        curated = await deps.requestCuratedWebGpuDevice(wantTimestampQuery, {
            powerPreference,
            rejectSoftwareAdapter: !webgpuExplicit,
        });
    } catch (error) {
        curated = { device: null, reason: errorMessage(error), limitNote: null };
    }

    if (!curated || !curated.device) {
        // Never fall through to a device-less WebGPURenderer: that is the
        // kitchen-sink path that requests every adapter feature (and, with no
        // adapter at all, Three's WebGL2 TSL backend).
        const failure = curated as CuratedWebGpuFailure | null;
        const detail = failure?.reason ?? 'navigator.gpu.requestAdapter missing';
        const limitNote = failure?.limitNote ?? null;
        const limitSuffix = limitNote ? `; ${limitNote}` : '';
        const reason = `WebGPU curated device unavailable (${detail}${limitSuffix}); using WebGLRenderer fallback.`;
        (failure?.softwareAdapter ? console.info : console.warn)(`[RendererFactory] ${reason}`);
        return buildWebGl(reason, {
            gpuLimitNote: limitNote,
            knownSoftware: failure?.softwareAdapter ? true : undefined,
            adapterDescription: failure?.adapterDescription ?? null,
        });
    }

    // `device` is `unknown`, so the `!curated.device` guard above cannot narrow.
    const device = curated as CuratedWebGpuDevice;
    const isSoftwareRenderer = options.isSoftwareRenderer ?? device.isSoftware;
    const selection = selectContextProfile({ searchParams, session, isSoftwareRenderer });
    const { contextOptions, meta } = profileMeta(selection, powerPreference);
    try {
        const renderer = await deps.createWebGpuRenderer({
            antialias: contextOptions.antialias,
            width,
            height,
            pixelRatio,
            powerPreference: contextOptions.powerPreference,
            curated: device,
            alpha: contextOptions.alpha,
            shadows: selection.profile.shadows,
        });

        if (rendererInfo) {
            console.info('[RendererFactory] WebGPU requiredLimits floor', WEBGPU_REQUIRED_LIMITS);
            console.info('[RendererFactory] WebGPU requiredFeatures', device.requiredFeatures);
            console.info('[RendererFactory] WebGPU adapter', {
                profile: selection.profile.id,
                profileReason: selection.reason,
                powerPreference: contextOptions.powerPreference,
                reasons: session.powerReasons,
                isSoftware: device.isSoftware,
                adapter: device.adapterDescription ?? null,
            });
        }

        return {
            renderer,
            rendererType: 'webgpu',
            usingWebGPU: true,
            usingWebGL: false,
            requestedRenderer: preferredRenderer,
            fallbackReason: null,
            ...meta,
            isSoftwareRenderer,
            glPowerPreference: contextOptions.powerPreference,
            powerReasons: session.powerReasons,
            softwareProbe: null,
            sampleCount: readWebGpuSampleCount(renderer, contextOptions.antialias),
            adapterDescription: device.adapterDescription ?? null,
        };
    } catch (error) {
        // renderer.init() (or something before it) failed after we'd already
        // obtained a curated device — release it rather than leaving an unused
        // GPUDevice around while we fall back to WebGL.
        (device.device as { destroy?: () => void } | undefined)?.destroy?.();
        const gpuLimitNote = describeLimitMismatches(device.adapterLimits);
        const limitSuffix = gpuLimitNote ? `; ${gpuLimitNote}` : '';
        const reason = `WebGPU init failed (${errorMessage(error)}${limitSuffix}); using WebGLRenderer fallback.`;
        console.warn(`[RendererFactory] ${reason}`, error);
        return buildWebGl(reason, {
            gpuLimitNote,
            adapterDescription: device.adapterDescription ?? null,
        });
    }
}

/** MSAA samples of the default framebuffer (1 = none); null when unreadable (stubs, lost context). */
function readWebGlSampleCount(
    renderer: { getContext?: () => unknown } | null | undefined
): number | null {
    try {
        const gl = renderer?.getContext?.() as WebGLRenderingContext | null | undefined;
        if (!gl || typeof gl.getParameter !== 'function') return null;
        const samples = Number(gl.getParameter(gl.SAMPLES));
        return Number.isFinite(samples) ? Math.max(1, samples) : null;
    } catch {
        return null;
    }
}

function readWebGpuSampleCount(renderer: unknown, antialias: boolean): number {
    const samples = (renderer as { samples?: unknown } | null)?.samples;
    if (typeof samples === 'number' && samples > 0) return samples;
    return antialias ? 4 : 1;
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
