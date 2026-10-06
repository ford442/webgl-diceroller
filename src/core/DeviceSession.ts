/**
 * One decision, made once at boot before any canvas or AudioContext exists:
 * which GPU power preference the tavern context asks for, whether the WebGL
 * software probe needs to run at all, and which AudioContext options audio
 * uses. `powerPreference` and `sampleRate` cannot be changed after a context
 * is created, so the quality hints have to be consulted here rather than once
 * the adaptive-quality profile exists.
 *
 * Every context in the app (tavern renderer, dice-case preview, the #315
 * overlay later) reads its attributes from this session plus
 * `RendererFactory`'s attribute helpers — never a hand-rolled bag.
 */
import { collectDeviceQualityHints } from './DeviceCapabilities.js';
import { isXrRequested } from '../xr/XrFlags.js';

export type RendererPreference = 'webgl' | 'webgpu';
export type GlPowerPreference = 'high-performance' | 'low-power';

/**
 * 48 kHz is what the worklet DSP, its biquads, and the generated room impulse
 * are tuned at; asking for it keeps `?test` captures identical across 44.1 kHz
 * and 48 kHz machines. The audio module falls back to the device rate (and
 * passes that real rate on) when the browser rejects the request.
 */
export const AUDIO_SAMPLE_RATE = 48000;

export interface AudioContextOptionsBag {
    latencyHint: 'interactive';
    sampleRate: number;
}

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

export interface DeviceSessionHints {
    preferredRenderer: RendererPreference;
    hasWebGpuApi: boolean;
    xr: boolean;
    /** Touch / coarse pointer primary input (phones, tablets, Quest browser). */
    touchPrimary: boolean;
    /** `navigator.hardwareConcurrency <= 4`, same threshold as DeviceCapabilities. */
    lowCores: boolean;
    isTest: boolean;
}

export interface DeviceSession {
    preferredRenderer: RendererPreference;
    hasWebGpuApi: boolean;
    xrCompatible: boolean;
    /**
     * Power preference before the software probe has run. A software rasterizer
     * found later only ever lowers it (see {@link resolvePowerPreference}).
     * Applies to the WebGPU adapter request too, despite the name.
     */
    glPowerPreference: GlPowerPreference;
    powerReasons: string[];
    /**
     * Whether booting needs the WebGL software probe. Skipped when the WebGPU
     * path will be tried first; createRenderer still probes lazily if WebGPU
     * then falls back to WebGL.
     */
    wantWebGlProbe: boolean;
    audio: AudioContextOptionsBag;
    isTest: boolean;
}

export function resolveDeviceSession(hints: DeviceSessionHints): DeviceSession {
    const powerReasons: string[] = [];
    if (hints.xr) powerReasons.push('xr');
    if (hints.touchPrimary) powerReasons.push('touch');
    if (hints.lowCores) powerReasons.push('low-cores');

    return {
        preferredRenderer: hints.preferredRenderer,
        hasWebGpuApi: hints.hasWebGpuApi,
        xrCompatible: hints.xr,
        glPowerPreference: powerReasons.length > 0 ? 'low-power' : 'high-performance',
        powerReasons,
        wantWebGlProbe: !(hints.hasWebGpuApi && hints.preferredRenderer === 'webgpu'),
        audio: { latencyHint: 'interactive', sampleRate: AUDIO_SAMPLE_RATE },
        isTest: hints.isTest,
    };
}

/** Final power preference for a real context once software-ness is known. */
export function resolvePowerPreference(
    session: DeviceSession,
    isSoftwareRenderer: boolean
): { powerPreference: GlPowerPreference; reasons: string[] } {
    if (!isSoftwareRenderer) {
        return { powerPreference: session.glPowerPreference, reasons: session.powerReasons };
    }
    return { powerPreference: 'low-power', reasons: [...session.powerReasons, 'software'] };
}

export function collectDeviceSessionHints(
    searchParams: URLSearchParams = new URLSearchParams(window.location.search)
): DeviceSessionHints {
    const quality = collectDeviceQualityHints(null);
    return {
        preferredRenderer: getRendererPreference(searchParams),
        hasWebGpuApi: typeof navigator !== 'undefined' && Boolean(navigator.gpu),
        xr: isXrRequested(searchParams),
        touchPrimary: quality.touchPrimary,
        lowCores: quality.lowCores,
        isTest: searchParams.has('test'),
    };
}

let cachedSession: DeviceSession | null = null;

/** The boot session — resolved on first call, then reused (incl. by renderer recovery). */
export function getDeviceSession(searchParams?: URLSearchParams): DeviceSession {
    if (!cachedSession) {
        cachedSession = resolveDeviceSession(collectDeviceSessionHints(searchParams));
    }
    return cachedSession;
}

export function resetDeviceSessionForTests(): void {
    cachedSession = null;
}
