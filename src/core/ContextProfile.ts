/**
 * Context profiles: the one typed table every GPU context in the app reads
 * its creation options from — the tavern renderer (WebGL or WebGPU), the
 * dice-case preview canvas, and the #315 overlay. A profile is picked once
 * per context from the boot {@link DeviceSession}, the software-rasterizer
 * answer and URL flags; `RendererFactory`'s attribute helpers are lookups
 * into it rather than a second hand-maintained bag.
 *
 * `powerPreference` here is a ceiling, not a demand: the DeviceSession may
 * already have lowered it (touch, low cores, XR, software), and a profile
 * can only lower it further — never ask a phone for the discrete GPU.
 */
import type { DeviceSession, GlPowerPreference } from './DeviceSession.js';

export type ContextProfileId = 'desktop' | 'mobile' | 'xr' | 'software' | 'overlay' | 'preview';

/**
 * - `msaa-at-pr1`: MSAA at pixel ratio 1, post FXAA above it (today's tavern rule).
 * - `msaa`: MSAA regardless of pixel ratio.
 * - `fxaa`: never MSAA; the post chain's FXAA handles edges.
 * - `none`: no antialiasing at all.
 */
export type ContextAntialias = 'msaa-at-pr1' | 'msaa' | 'fxaa' | 'none';
export type ContextShadows = 'pcf-soft' | 'pcf' | 'basic' | 'off';
export type ContextPost = 'full' | 'low' | 'none';

export interface ContextProfile {
    id: ContextProfileId;
    /** Real alpha in the drawing buffer (transparent clear, page shows through). */
    alpha: boolean;
    antialias: ContextAntialias;
    powerPreference: GlPowerPreference;
    shadows: ContextShadows;
    post: ContextPost;
    xrCompatible: boolean;
    /**
     * Never try WebGPU (nor Three's WebGL2 TSL backend): the classic
     * `WebGLRenderer` is the only path this profile is known to work on.
     */
    classicWebGlOnly: boolean;
}

export const CONTEXT_PROFILES: Readonly<Record<ContextProfileId, Readonly<ContextProfile>>> = {
    desktop: {
        id: 'desktop',
        alpha: false,
        antialias: 'msaa-at-pr1',
        powerPreference: 'high-performance',
        shadows: 'pcf-soft',
        post: 'full',
        xrCompatible: false,
        classicWebGlOnly: false,
    },
    mobile: {
        id: 'mobile',
        alpha: false,
        antialias: 'fxaa',
        powerPreference: 'low-power',
        shadows: 'pcf',
        post: 'low',
        xrCompatible: false,
        classicWebGlOnly: false,
    },
    // Quest-class headsets are mobile SoCs: DeviceSession already asks for
    // low-power under ?xr, and WebXR needs WebGLRenderer.xr.
    xr: {
        id: 'xr',
        alpha: false,
        antialias: 'msaa',
        powerPreference: 'low-power',
        shadows: 'basic',
        post: 'none',
        xrCompatible: true,
        classicWebGlOnly: true,
    },
    // SwiftShader / llvmpipe / lavapipe. Antialias and shadows keep the
    // desktop values for now: the checked-in render baselines are captured on
    // SwiftShader, so dropping MSAA or shadows here has to land together with
    // `npm run baselines:update` (a WASM-equipped capture).
    software: {
        id: 'software',
        alpha: false,
        antialias: 'msaa-at-pr1',
        powerPreference: 'low-power',
        shadows: 'pcf-soft',
        post: 'low',
        xrCompatible: false,
        classicWebGlOnly: true,
    },
    // #315: the dice drawn over a host page, which must show through.
    overlay: {
        id: 'overlay',
        alpha: true,
        antialias: 'msaa',
        powerPreference: 'low-power',
        shadows: 'off',
        post: 'none',
        xrCompatible: false,
        classicWebGlOnly: false,
    },
    // The lazy dice-case canvas. Browsers cap live GL contexts (8–16) and
    // Intel / SwiftShader / Quest hit that first, so a secondary canvas never
    // asks for the high-performance slot or for MSAA.
    preview: {
        id: 'preview',
        alpha: true,
        antialias: 'none',
        powerPreference: 'low-power',
        shadows: 'off',
        post: 'none',
        xrCompatible: false,
        classicWebGlOnly: true,
    },
};

export function isContextProfileId(value: unknown): value is ContextProfileId {
    return (
        typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTEXT_PROFILES, value)
    );
}

/** `?context=<id>` when it names a profile, else null. */
export function getForcedContextProfileId(searchParams: URLSearchParams): ContextProfileId | null {
    const value = searchParams.get('context');
    return isContextProfileId(value) ? value : null;
}

export interface ContextProfileSelection {
    profile: Readonly<ContextProfile>;
    /** Why this profile: `forced (?context=…)`, `?overlay`, `xr`, `software`, `touch`, `default`. */
    reason: string;
    forced: boolean;
}

export interface SelectContextProfileOptions {
    searchParams: URLSearchParams;
    session: Pick<DeviceSession, 'xrCompatible' | 'powerReasons'>;
    /** Known software rasterizer (WebGL probe, WebGPU adapter, or recovery). */
    isSoftwareRenderer?: boolean;
}

/**
 * Pick the tavern context's profile. `preview` is never chosen here — it
 * belongs to the dice-case canvas, which looks it up by name.
 */
export function selectContextProfile({
    searchParams,
    session,
    isSoftwareRenderer = false,
}: SelectContextProfileOptions): ContextProfileSelection {
    const forced = getForcedContextProfileId(searchParams);
    if (forced) {
        return {
            profile: CONTEXT_PROFILES[forced],
            reason: `forced (?context=${forced})`,
            forced: true,
        };
    }
    const pick = (id: ContextProfileId, reason: string): ContextProfileSelection => ({
        profile: CONTEXT_PROFILES[id],
        reason,
        forced: false,
    });
    if (session.xrCompatible) return pick('xr', 'xr');
    if (searchParams.has('overlay')) return pick('overlay', '?overlay');
    if (isSoftwareRenderer) return pick('software', 'software rasterizer');
    if (session.powerReasons.includes('touch')) return pick('mobile', 'touch');
    return pick('desktop', 'default');
}

/** Whether the context itself should be created with MSAA. */
export function resolveProfileAntialias(profile: ContextProfile, pixelRatio: number): boolean {
    switch (profile.antialias) {
        case 'msaa':
            return true;
        case 'msaa-at-pr1':
            return pixelRatio <= 1.0;
        case 'fxaa':
        case 'none':
            return false;
    }
}

/** Whether the post chain should run FXAA (only profiles that use post AA). */
export function resolveProfilePostAA(
    profile: ContextProfile,
    contextAntialias: boolean,
    pixelRatio: number
): boolean {
    if (profile.post === 'none' || profile.antialias === 'none') return false;
    if (profile.antialias === 'fxaa') return true;
    return !contextAntialias && pixelRatio > 1;
}

/** The profile's ceiling applied to the power preference the session settled on. */
export function resolveProfilePowerPreference(
    profile: ContextProfile,
    sessionPreference: GlPowerPreference
): GlPowerPreference {
    return profile.powerPreference === 'low-power' ? 'low-power' : sessionPreference;
}
