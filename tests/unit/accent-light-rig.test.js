import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createAccentLightRig } from '../../src/core/AccentLightRig.js';
import { QUALITY_PROFILES, setAccentLightsEnabled } from '../../src/core/AdaptiveQuality.js';

const webgpu = { usingWebGPU: true };
const webgl = { usingWebGPU: false };

function build(options) {
    return createAccentLightRig(new THREE.Scene(), {
        searchParams: new URLSearchParams(''),
        ...options,
    });
}

describe('createAccentLightRig gating', () => {
    it('stays inert on the WebGL baseline even at the high profile', async () => {
        const rig = await build({ rendererState: webgl, profile: QUALITY_PROFILES.high });
        expect(rig.enabled).toBe(false);
        expect(rig.lights).toHaveLength(0);
        expect(rig.reason).toMatch(/WebGPU/);
    });

    it.each([['medium'], ['mobile'], ['xr']])(
        'stays inert on WebGPU at the %s profile',
        async (id) => {
            const rig = await build({ rendererState: webgpu, profile: QUALITY_PROFILES[id] });
            expect(rig.enabled).toBe(false);
            expect(rig.lights).toHaveLength(0);
        }
    );

    it('stays inert under prefers-reduced-motion', async () => {
        const rig = await build({
            rendererState: webgpu,
            profile: QUALITY_PROFILES.high,
            reducedMotion: true,
        });
        expect(rig.enabled).toBe(false);
    });

    it('stays inert behind ?no-accent-lights', async () => {
        const rig = await createAccentLightRig(new THREE.Scene(), {
            rendererState: webgpu,
            profile: QUALITY_PROFILES.high,
            searchParams: new URLSearchParams('no-accent-lights'),
        });
        expect(rig.enabled).toBe(false);
    });

    it('adds no scene children when inert', async () => {
        const scene = new THREE.Scene();
        await createAccentLightRig(scene, {
            rendererState: webgl,
            profile: QUALITY_PROFILES.high,
            searchParams: new URLSearchParams(''),
        });
        expect(scene.children).toHaveLength(0);
    });

    it('exposes a no-op setEnabled/dispose so callers need no renderer checks', async () => {
        const rig = await build({ rendererState: webgl, profile: QUALITY_PROFILES.high });
        expect(() => rig.setEnabled(true)).not.toThrow();
        expect(() => rig.dispose()).not.toThrow();
    });
});

describe('QUALITY_PROFILES.extraLights', () => {
    it('is enabled only on the high profile', () => {
        expect(QUALITY_PROFILES.high.extraLights).toBe(true);
        for (const id of ['medium', 'mobile', 'xr']) {
            expect(QUALITY_PROFILES[id].extraLights).toBe(false);
        }
    });
});

describe('setAccentLightsEnabled', () => {
    it('is a no-op on a scene with no rig', () => {
        expect(() => setAccentLightsEnabled(new THREE.Scene(), false)).not.toThrow();
    });

    it('forwards to the rig stored on the scene', () => {
        const scene = new THREE.Scene();
        const calls = [];
        scene.userData.accentLightRig = { setEnabled: (v) => calls.push(v) };

        setAccentLightsEnabled(scene, false);
        setAccentLightsEnabled(scene, true);

        expect(calls).toEqual([false, true]);
    });
});
