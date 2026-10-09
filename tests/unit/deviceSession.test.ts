import { describe, expect, it } from 'vitest';
import {
    AUDIO_SAMPLE_RATE,
    resolveDeviceSession,
    resolvePowerPreference,
    type DeviceSessionHints,
} from '../../src/core/DeviceSession';

const DESKTOP: DeviceSessionHints = {
    preferredRenderer: 'webgpu',
    hasWebGpuApi: true,
    xr: false,
    touchPrimary: false,
    lowCores: false,
    isTest: false,
};

describe('resolveDeviceSession', () => {
    it('keeps desktop discrete GPUs on high-performance', () => {
        const session = resolveDeviceSession(DESKTOP);
        expect(session.glPowerPreference).toBe('high-performance');
        expect(session.powerReasons).toEqual([]);
    });

    it.each([
        ['xr', { xr: true }],
        ['touch', { touchPrimary: true }],
        ['low-cores', { lowCores: true }],
    ] as const)('drops to low-power for %s', (reason, overrides) => {
        const session = resolveDeviceSession({ ...DESKTOP, ...overrides });
        expect(session.glPowerPreference).toBe('low-power');
        expect(session.powerReasons).toContain(reason);
    });

    it('lets a software rasterizer lower, never raise, the preference', () => {
        const desktop = resolveDeviceSession(DESKTOP);
        expect(resolvePowerPreference(desktop, false).powerPreference).toBe('high-performance');
        const software = resolvePowerPreference(desktop, true);
        expect(software.powerPreference).toBe('low-power');
        expect(software.reasons).toContain('software');
    });

    it('skips the WebGL probe only when WebGPU will be tried first', () => {
        expect(resolveDeviceSession(DESKTOP).wantWebGlProbe).toBe(false);
        expect(
            resolveDeviceSession({ ...DESKTOP, preferredRenderer: 'webgl' }).wantWebGlProbe
        ).toBe(true);
        expect(resolveDeviceSession({ ...DESKTOP, hasWebGpuApi: false }).wantWebGlProbe).toBe(true);
    });

    it('carries xrCompatible from ?xr', () => {
        expect(resolveDeviceSession({ ...DESKTOP, xr: true }).xrCompatible).toBe(true);
        expect(resolveDeviceSession(DESKTOP).xrCompatible).toBe(false);
    });

    it.each([false, true])('requests interactive 48 kHz audio (isTest=%s)', (isTest) => {
        expect(resolveDeviceSession({ ...DESKTOP, isTest }).audio).toEqual({
            latencyHint: 'interactive',
            sampleRate: AUDIO_SAMPLE_RATE,
        });
        expect(AUDIO_SAMPLE_RATE).toBe(48000);
    });
});
