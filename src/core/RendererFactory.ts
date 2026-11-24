import type { WebGPURenderer } from 'three/webgpu';
import type { RendererState } from '../types/app';
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
    resolveProfilePostAA,
    selectContextProfile,
    type ContextProfileSelection,
} from './ContextProfile.js';
import { resolvePixelRatioConfig } from './PixelRatioPolicy.js';
import {
    createWebGlRenderer,
    getProfileContextOptions,
    probeSoftwareWebGL,
    readWebGlSampleCount,
    type SoftwareProbeResult,
    type WebGlRendererArgs,
    type WebGlRendererBundle,
} from './WebGlContext.js';
import {
    WEBGPU_REQUIRED_LIMITS,
    createWebGpuRenderer,
    describeLimitMismatches,
    errorMessage,
    readWebGpuSampleCount,
    requestCuratedWebGpuDevice,
    wantsWebGpuTimestampQuery,
    type CuratedWebGpuDevice,
    type CuratedWebGpuFailure,
    type WebGpuRendererArgs,
} from './WebGpuDevice.js';

// `RendererFactory` stays the one import site for renderer construction: the
// pieces live in their own modules (pixel-ratio policy, WebGL context, WebGPU
// device, loss recovery) and are re-exported here unchanged.
export { isXrRequested, getXrSnapDegrees } from '../xr/XrFlags.js';
export { getRendererPreference } from './DeviceSession.js';
export type { GetRendererPreferenceOptions, RendererPreference } from './DeviceSession.js';
export {
    applyRendererSize,
    createPixelRatioMonitor,
    resolveAntialias,
    resolvePixelRatioConfig,
    syncComposerPixelRatio,
} from './PixelRatioPolicy.js';
export type {
    PixelRatioConfig,
    PixelRatioMonitor,
    PixelRatioMonitorOptions,
} from './PixelRatioPolicy.js';
export {
    PREVIEW_WEBGL_CONTEXT,
    SOFTWARE_PROBE_CONTEXT_ATTRIBUTES,
    getProfileContextOptions,
    getWebGlContextAttributes,
    getWebGlRendererParameters,
    isSoftwareRendererString,
    probeSoftwareWebGL,
} from './WebGlContext.js';
export type {
    ProbeSoftwareWebGlOptions,
    SoftwareProbeResult,
    TavernWebGlContextAttributes,
    WebGlContextAttributeOptions,
    WebGlRendererArgs,
} from './WebGlContext.js';
export {
    WEBGPU_CURATED_FEATURES,
    WEBGPU_REQUIRED_LIMITS,
    WEBGPU_TEXTURE_COMPRESSION_FEATURES,
    WEBGPU_TIMESTAMP_QUERY_FEATURE,
    describeLimitMismatches,
    describeWebGpuAdapter,
    getWebGpuRendererParameters,
    getWebGpuRequiredFeatures,
    isSoftwareWebGpuAdapter,
    requestCuratedWebGpuDevice,
    wantsWebGpuTimestampQuery,
} from './WebGpuDevice.js';
export type {
    CuratedWebGpuDevice,
    CuratedWebGpuFailure,
    RequestCuratedWebGpuDeviceOptions,
    WebGpuRendererArgs,
} from './WebGpuDevice.js';
export { installRendererRecoveryHandlers } from './RendererRecovery.js';
export type { RendererRecoveryHandlers } from './RendererRecovery.js';

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
