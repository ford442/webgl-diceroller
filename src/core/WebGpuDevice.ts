import type { WebGPURenderer } from 'three/webgpu';
import type { GlPowerPreference } from './DeviceSession.js';
import type { ContextShadows } from './ContextProfile.js';
import { applySharedRendererConfig } from './RendererConfig.js';
// The adapter check reuses the one "is this a software rasterizer" pattern.
import { isSoftwareRendererString } from './WebGlContext.js';

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

/**
 * Texture-compression features, requested only when the adapter reports them.
 *
 * The shared PBR textures ship as KTX2 (see TexturePipeline.js). `KTX2Loader`
 * decides its transcode target from `renderer.hasFeature(...)`, which reads
 * the *device's* feature set, not the adapter's. With none of these enabled
 * the loader transcodes to uncompressed RGBA, which Three wraps in a
 * `CompressedTexture` that `WebGPUTextureUtils._getBlockData` has no entry for
 * and the upload throws `Cannot read properties of undefined (reading 'width')`
 * inside the first draw of every prop that uses a shared texture.
 *
 * Only the three families `KTX2Loader` can target on WebGPU (BC on desktop,
 * ASTC on Apple / mobile, ETC2 on mobile) are listed. They are texture-format
 * capabilities and do not touch the simulation or its replay surface.
 */
export const WEBGPU_TEXTURE_COMPRESSION_FEATURES: readonly string[] = [
    'texture-compression-bc',
    'texture-compression-astc',
    'texture-compression-etc2',
];

/** GPU feature name gating `WebGPURenderer`'s `trackTimestamp` (GPU pass timing). */
export const WEBGPU_TIMESTAMP_QUERY_FEATURE = 'timestamp-query';

/** `?debug-perf` / `?gpu-timer` opt into GPU-timestamp pass timing (see createRenderer). */
export function wantsWebGpuTimestampQuery(searchParams: URLSearchParams): boolean {
    return searchParams.has('debug-perf') || searchParams.has('gpu-timer');
}

/**
 * Curated `requiredFeatures` for `adapter.requestDevice()`: the documented
 * floor (currently empty), the texture-compression features the adapter
 * reports (see WEBGPU_TEXTURE_COMPRESSION_FEATURES), plus `timestamp-query`
 * when both the caller wants GPU-timestamp tracking and the adapter supports it. Never
 * requests a feature the adapter lacks — `requestDevice` rejects on an
 * unsupported required feature, and that would turn "no GPU timer" into
 * "no WebGPU at all".
 */
export function getWebGpuRequiredFeatures(
    adapterFeatures: { has(name: string): boolean },
    { wantTimestampQuery }: { wantTimestampQuery: boolean }
): string[] {
    const features = [...WEBGPU_CURATED_FEATURES];
    for (const name of WEBGPU_TEXTURE_COMPRESSION_FEATURES) {
        if (adapterFeatures.has(name)) features.push(name);
    }
    if (wantTimestampQuery && adapterFeatures.has(WEBGPU_TIMESTAMP_QUERY_FEATURE)) {
        features.push(WEBGPU_TIMESTAMP_QUERY_FEATURE);
    }
    return features;
}

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

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
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

export async function createWebGpuRenderer({
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
    // WebGPURenderer quietly swaps in its WebGL2 TSL backend when
    // WebGPUBackend.init() throws (e.g. the canvas has no 'webgpu' context even
    // though the curated device exists). That backend is the one we never run
    // (see the device-less note in createRenderer), and the app would still
    // label it "webgpu". Drop the fallback so init() rejects with the real
    // error and createRenderer falls back to the classic WebGLRenderer.
    Object.assign(renderer, { _getFallback: null });
    applySharedRendererConfig(renderer, width, height, pixelRatio, { shadows, alpha });
    await renderer.init();
    if ((renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend !== true) {
        renderer.dispose();
        throw new Error('WebGPURenderer did not start its WebGPU backend');
    }
    return renderer;
}

export function readWebGpuSampleCount(renderer: unknown, antialias: boolean): number {
    const samples = (renderer as { samples?: unknown } | null)?.samples;
    if (typeof samples === 'number' && samples > 0) return samples;
    return antialias ? 4 : 1;
}
