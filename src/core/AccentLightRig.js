import * as THREE from 'three';
import { TABLE_SURFACE_Y } from './SceneMetrics.js';

/**
 * Soft area lighting for the high-quality WebGPU path only.
 *
 * The baseline rig (ambient + hemisphere + candle point + moonlight spot + dice
 * fill, see SceneSetup.js) is what every renderer gets and is not touched here.
 * On WebGPU at `QUALITY_PROFILES.high` we can additionally afford `RectAreaLight`,
 * which gives the window, the hearth and the lamp shade real area falloff instead
 * of a point approximation.
 *
 * Deliberate constraints:
 * - WebGL/mobile/XR never construct these lights and never download the LTC
 *   tables (`RectAreaLightTexturesLib` is ~300 KB, dynamically imported).
 * - `RectAreaLight` cannot cast shadows in Three.js, so this rig is invisible to
 *   `applyShadowLightPolicy` and cannot add shadow-map cost.
 * - The runtime governor drops the rig first under frame-time stress.
 */

/** Rect-area panels, authored against TavernWalls.js geometry. */
const ACCENT_LIGHTS = [
    {
        // Window aperture in the left wall: inner face x = -20, opening is
        // 6 wide on Z centered at z = -5, 10 tall on Y centered at y = 4.
        name: 'AccentWindowLight',
        color: 0x6f83d6,
        intensity: 3.2,
        width: 6,
        height: 10,
        position: [-19.5, 4, -5],
        lookAt: [0, 4, -5],
    },
    {
        // Fireplace opening in the right wall, between the pillars at z = ±2.25.
        name: 'AccentHearthLight',
        color: 0xff7a33,
        intensity: 4.5,
        width: 3,
        height: 3.2,
        position: [17.2, -8, 0],
        lookAt: [0, -8, 0],
    },
    {
        // Underside of the billiard lamp shades, pooled over the velvet zone.
        name: 'AccentLampLight',
        color: 0xffe2b0,
        intensity: 2.4,
        width: 16,
        height: 16,
        position: [0, 8.5, 0],
        lookAt: [0, TABLE_SURFACE_Y, 0],
    },
];

/** Null rig returned on every path that does not qualify. */
function createDisabledRig(reason) {
    return {
        enabled: false,
        reason,
        lights: [],
        setEnabled() {},
        dispose() {},
    };
}

/**
 * @param {import('three').Scene} scene
 * @param {{
 *   rendererState?: { usingWebGPU?: boolean } | null,
 *   profile?: { id?: string, extraLights?: boolean } | null,
 *   reducedMotion?: boolean,
 *   searchParams?: URLSearchParams | null,
 * }} options
 * @returns {Promise<{
 *   enabled: boolean,
 *   reason?: string,
 *   lights: import('three').Light[],
 *   setEnabled: (value: boolean) => void,
 *   dispose: () => void,
 * }>}
 */
export async function createAccentLightRig(
    scene,
    { rendererState = null, profile = null, reducedMotion = false, searchParams = null } = {}
) {
    const params =
        searchParams ??
        new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

    if (params.has('no-accent-lights')) return createDisabledRig('disabled by ?no-accent-lights');
    if (!rendererState?.usingWebGPU) return createDisabledRig('requires WebGPU');
    if (!profile?.extraLights) return createDisabledRig(`quality profile "${profile?.id}"`);
    if (reducedMotion) return createDisabledRig('prefers-reduced-motion');

    // RectAreaLightNode reads the LTC BRDF tables at material-compile time and
    // throws if they were never installed, so this has to resolve before the
    // lights reach a render.
    try {
        const [{ RectAreaLightNode }, { RectAreaLightTexturesLib }] = await Promise.all([
            import('three/webgpu'),
            import('three/addons/lights/RectAreaLightTexturesLib.js'),
        ]);
        RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
    } catch (error) {
        console.warn(
            '[AccentLightRig] RectAreaLight LTC tables unavailable; keeping the baseline rig.',
            error
        );
        return createDisabledRig('LTC tables failed to load');
    }

    /** @type {import('three').RectAreaLight[]} */
    const lights = [];

    for (const spec of ACCENT_LIGHTS) {
        const light = new THREE.RectAreaLight(spec.color, spec.intensity, spec.width, spec.height);
        light.name = spec.name;
        light.position.set(...spec.position);
        light.lookAt(...spec.lookAt);
        scene.add(light);
        lights.push(light);
    }

    console.info(`[AccentLightRig] ${lights.length} rect-area accent lights active (WebGPU high).`);

    return {
        enabled: true,
        lights,
        setEnabled(value) {
            for (const light of lights) light.visible = value !== false;
        },
        dispose() {
            for (const light of lights) {
                light.parent?.remove(light);
                light.dispose?.();
            }
            lights.length = 0;
        },
    };
}
