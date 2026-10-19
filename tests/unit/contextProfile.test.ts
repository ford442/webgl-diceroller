import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    CONTEXT_PROFILES,
    getForcedContextProfileId,
    resolveProfileAntialias,
    resolveProfilePostAA,
    resolveProfilePowerPreference,
    selectContextProfile,
    type ContextProfileId,
} from '../../src/core/ContextProfile';
import { resolveDeviceSession, type DeviceSessionHints } from '../../src/core/DeviceSession';
import {
    describeWebGpuAdapter,
    getProfileContextOptions,
    getWebGlContextAttributes,
    PREVIEW_WEBGL_CONTEXT,
    requestCuratedWebGpuDevice,
} from '../../src/core/RendererFactory';

const DESKTOP: DeviceSessionHints = {
    preferredRenderer: 'webgpu',
    hasWebGpuApi: true,
    xr: false,
    touchPrimary: false,
    lowCores: false,
    isTest: false,
};

const session = (overrides: Partial<DeviceSessionHints> = {}) =>
    resolveDeviceSession({ ...DESKTOP, ...overrides });

const params = (query = '') => new URLSearchParams(query);

describe('CONTEXT_PROFILES', () => {
    // One row per profile: the context attributes it produces at pr=1 and pr=2.
    it.each([
        [
            'desktop',
            {
                alpha: false,
                aa1: true,
                aa2: false,
                power: 'high-performance',
                shadows: 'pcf-soft',
                post: 'full',
                xr: false,
                classic: false,
            },
        ],
        [
            'mobile',
            {
                alpha: false,
                aa1: false,
                aa2: false,
                power: 'low-power',
                shadows: 'pcf',
                post: 'low',
                xr: false,
                classic: false,
            },
        ],
        [
            'xr',
            {
                alpha: false,
                aa1: true,
                aa2: true,
                power: 'low-power',
                shadows: 'basic',
                post: 'none',
                xr: true,
                classic: true,
            },
        ],
        [
            'software',
            {
                alpha: false,
                aa1: true,
                aa2: false,
                power: 'low-power',
                shadows: 'pcf-soft',
                post: 'low',
                xr: false,
                classic: true,
            },
        ],
        [
            'overlay',
            {
                alpha: true,
                aa1: true,
                aa2: true,
                power: 'low-power',
                shadows: 'off',
                post: 'none',
                xr: false,
                classic: false,
            },
        ],
        [
            'preview',
            {
                alpha: true,
                aa1: false,
                aa2: false,
                power: 'low-power',
                shadows: 'off',
                post: 'none',
                xr: false,
                classic: true,
            },
        ],
    ] as const)('%s', (id, want) => {
        const profile = CONTEXT_PROFILES[id];
        expect(profile.id).toBe(id);
        expect(profile.shadows).toBe(want.shadows);
        expect(profile.post).toBe(want.post);
        expect(profile.classicWebGlOnly).toBe(want.classic);

        const at1 = getWebGlContextAttributes(getProfileContextOptions(profile, { pixelRatio: 1 }));
        expect(at1.alpha).toBe(want.alpha);
        expect(at1.antialias).toBe(want.aa1);
        expect(at1.powerPreference).toBe(want.power);
        expect(at1.xrCompatible).toBe(want.xr);
        // The rest of the bag is fixed for every profile.
        expect(at1).toMatchObject({
            depth: true,
            stencil: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            failIfMajorPerformanceCaveat: false,
        });
        expect(resolveProfileAntialias(profile, 2)).toBe(want.aa2);
    });

    it('lets a profile lower, never raise, the session power preference', () => {
        expect(resolveProfilePowerPreference(CONTEXT_PROFILES.desktop, 'low-power')).toBe(
            'low-power'
        );
        expect(resolveProfilePowerPreference(CONTEXT_PROFILES.desktop, 'high-performance')).toBe(
            'high-performance'
        );
        expect(resolveProfilePowerPreference(CONTEXT_PROFILES.overlay, 'high-performance')).toBe(
            'low-power'
        );
    });

    it('keeps the dice-case preview bag on the preview row', () => {
        expect(PREVIEW_WEBGL_CONTEXT).toEqual({
            antialias: false,
            alpha: true,
            powerPreference: 'low-power',
            xrCompatible: false,
        });
    });

    it('runs post FXAA only where the profile uses it', () => {
        const { desktop, mobile, overlay, preview } = CONTEXT_PROFILES;
        expect(resolveProfilePostAA(desktop, true, 1)).toBe(false);
        expect(resolveProfilePostAA(desktop, false, 2)).toBe(true);
        expect(resolveProfilePostAA(mobile, false, 1)).toBe(true);
        expect(resolveProfilePostAA(overlay, true, 2)).toBe(false);
        expect(resolveProfilePostAA(preview, false, 2)).toBe(false);
    });
});

describe('selectContextProfile', () => {
    it.each([
        ['desktop', '', {}, false, 'default'],
        ['mobile', '', { touchPrimary: true }, false, 'touch'],
        ['xr', 'xr', { xr: true }, false, 'xr'],
        ['software', '', {}, true, 'software rasterizer'],
        ['overlay', 'overlay', {}, false, '?overlay'],
    ] as const)('picks %s', (id, query, hints, isSoftwareRenderer, reason) => {
        const selection = selectContextProfile({
            searchParams: params(query),
            session: session(hints),
            isSoftwareRenderer,
        });
        expect(selection.profile.id).toBe(id);
        expect(selection.reason).toBe(reason);
        expect(selection.forced).toBe(false);
    });

    it('lets XR win over ?overlay and a software rasterizer', () => {
        const selection = selectContextProfile({
            searchParams: params('xr&overlay'),
            session: session({ xr: true }),
            isSoftwareRenderer: true,
        });
        expect(selection.profile.id).toBe('xr');
    });

    it('never picks preview on its own', () => {
        for (const isSoftwareRenderer of [false, true]) {
            for (const hints of [{}, { touchPrimary: true }, { lowCores: true }]) {
                const { profile } = selectContextProfile({
                    searchParams: params(),
                    session: session(hints),
                    isSoftwareRenderer,
                });
                expect(profile.id).not.toBe('preview');
            }
        }
    });

    it.each(Object.keys(CONTEXT_PROFILES) as ContextProfileId[])(
        '?context=%s forces that row',
        (id) => {
            const selection = selectContextProfile({
                searchParams: params(`context=${id}`),
                session: session({ touchPrimary: true }),
                isSoftwareRenderer: true,
            });
            expect(selection.profile.id).toBe(id);
            expect(selection.forced).toBe(true);
        }
    );

    it('ignores an unknown ?context value', () => {
        expect(getForcedContextProfileId(params('context=hdr'))).toBeNull();
        expect(getForcedContextProfileId(params('context=toString'))).toBeNull();
    });
});

describe('requestCuratedWebGpuDevice adapter routing', () => {
    afterEach(() => vi.unstubAllGlobals());

    const stubAdapter = (info: Record<string, unknown>, isFallbackAdapter = false) => {
        const requestDevice = vi.fn(async () => ({ destroy() {} }));
        vi.stubGlobal('navigator', {
            gpu: {
                requestAdapter: async () => ({
                    features: new Set<string>(),
                    limits: { maxTextureDimension2D: 8192 },
                    info,
                    isFallbackAdapter,
                    requestDevice,
                }),
            },
        });
        return requestDevice;
    };

    it('refuses a software adapter before any device exists', async () => {
        const requestDevice = stubAdapter({ vendor: 'google', architecture: 'swiftshader' });
        const result = await requestCuratedWebGpuDevice(false, { rejectSoftwareAdapter: true });
        expect(result?.device).toBeNull();
        expect(result && 'softwareAdapter' in result && result.softwareAdapter).toBe(true);
        expect(requestDevice).not.toHaveBeenCalled();
    });

    it('refuses a fallback adapter even with a hardware-looking name', async () => {
        stubAdapter({ vendor: 'microsoft', description: 'Basic Render Driver' }, true);
        const result = await requestCuratedWebGpuDevice(false, { rejectSoftwareAdapter: true });
        expect(result?.device).toBeNull();
    });

    it('keeps a software adapter when the caller allows it (?webgpu)', async () => {
        const requestDevice = stubAdapter({ architecture: 'swiftshader' });
        const result = await requestCuratedWebGpuDevice(false, { rejectSoftwareAdapter: false });
        expect(result?.device).not.toBeNull();
        expect(result && 'isSoftware' in result && result.isSoftware).toBe(true);
        expect(requestDevice).toHaveBeenCalledOnce();
    });

    it('passes a hardware adapter through and describes it', async () => {
        stubAdapter({ vendor: 'nvidia', architecture: 'ampere' });
        const result = await requestCuratedWebGpuDevice(false, { rejectSoftwareAdapter: true });
        expect(result?.device).not.toBeNull();
        expect(result?.adapterDescription).toBe('nvidia ampere');
    });

    it('describes adapters without duplicating fields', () => {
        expect(describeWebGpuAdapter({ vendor: 'apple', architecture: 'apple', device: '' })).toBe(
            'apple'
        );
        expect(describeWebGpuAdapter({}, true)).toBe('unknown (fallback adapter)');
        expect(describeWebGpuAdapter(null)).toBeNull();
    });
});
