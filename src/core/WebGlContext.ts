import * as THREE from 'three';
import type { GlPowerPreference, RendererPreference } from './DeviceSession.js';
import {
    CONTEXT_PROFILES,
    resolveProfileAntialias,
    resolveProfilePowerPreference,
    type ContextProfile,
    type ContextShadows,
} from './ContextProfile.js';
import { applySharedRendererConfig } from './RendererConfig.js';

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

export interface WebGlRendererBundle {
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

export function createWebGlRenderer({
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
        context: context as WebGLRenderingContext,
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

/** MSAA samples of the default framebuffer (1 = none); null when unreadable (stubs, lost context). */
export function readWebGlSampleCount(
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
