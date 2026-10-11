/**
 * Moonlight god-ray beam, written once.
 *
 * `GodRayShader` (GLSL `ShaderMaterial`, WebGL) and `GodRayNodeMaterial` (TSL
 * `MeshBasicNodeMaterial`, WebGPU) both build this graph through a
 * `ShaderKit`, and both take their numbers from `GOD_RAY_PARAMS`.
 *
 * The look: two scrolling samples of a noise texture mixed into "dust", a soft
 * fade toward the far end of the beam, a brighter term near the window, and a
 * low additive alpha.
 */

export const GOD_RAY_PARAMS = Object.freeze({
    /** Cool blue-white. */
    color: 0xddeeff,
    /** Noise scroll, UV units per second. */
    speed: 0.1,
    /** Overall alpha — the beam is a subtle additive glow. */
    opacity: 0.4,
});

/**
 * Beam alpha for one fragment.
 *
 * @param {any} k ShaderKit
 * @param {{ uv: any, time: any, speed: any, noise: any, opacity: any }} u graph inputs
 */
export function godRayAlpha(k, u) {
    const vY = k.swizzle(u.uv, 'y');
    const scroll = k.mul(u.time, u.speed);

    // Scroll the noise up the beam from the window source.
    const scrollUv = k.variable('vec2', k.vec2(k.swizzle(u.uv, 'x'), k.add(vY, scroll)));
    const noise = k.swizzle(k.sample(u.noise, scrollUv), 'r');
    // Second, larger / slower layer for cloudy complexity.
    const noise2 = k.swizzle(
        k.sample(u.noise, k.sub(k.mul(scrollUv, 0.5), k.vec2(0, k.mul(scroll, 0.5)))),
        'r'
    );
    const dust = k.mix(noise, noise2, 0.5);

    // Fade out near the bottom of the beam, brighten near the source.
    const beamFade = k.smoothstep(0, 0.4, vY);
    const intensity = k.add(
        k.mul(k.add(k.mul(dust, 0.8), 0.2), beamFade),
        k.mul(k.pow(vY, 2), 0.3)
    );
    return k.mul(intensity, u.opacity);
}
