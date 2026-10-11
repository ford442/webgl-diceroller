/**
 * The numbers the fullscreen post stack is tuned with, for both renderers.
 *
 * WebGL runs an `EffectComposer` (`UnrealBloomPass` → vignette `ShaderPass` →
 * FXAA → `OutputPass`); WebGPU runs a TSL `PostProcessing` graph (bloom →
 * vignette → chromatic aberration → FXAA). The pipelines differ, the numbers
 * must not: both read them from here, and the vignette itself is one graph
 * (`vignette`) built by both.
 */

export const VIGNETTE_PARAMS = Object.freeze({
    /** Scales the centred UV before the falloff — larger reaches further in. */
    offset: 1.2,
    darkness: 0.85,
});

/** Chromatic aberration (WebGPU `high` post quality only). */
export const CHROMATIC_PARAMS = Object.freeze({
    strength: 0.2,
    center: Object.freeze([0.5, 0.5]),
    scale: 1.08,
});

/**
 * Bloom tuning per post quality.
 *
 * @param {'low'|'high'|string} quality `postConfig.quality`
 */
export function bloomParams(quality) {
    const low = quality === 'low';
    return {
        strength: low ? 0.35 : 0.6,
        radius: low ? 0.25 : 0.4,
        threshold: 0.6,
        /** WebGL renders bloom at 1/scale of the drawing buffer. */
        resolutionScale: low ? 4 : 2,
    };
}

/**
 * Darken toward the corners.
 *
 * @param {any} k ShaderKit
 * @param {{ color: any, uv: any, offset: any, darkness: any }} u graph inputs —
 *   `color` is the incoming vec4, `uv` the 0..1 screen coordinate
 */
export function vignette(k, u) {
    const centred = k.variable('vec2', k.mul(k.sub(u.uv, k.vec2(0.5, 0.5)), u.offset));
    const amount = k.clamp(k.mul(k.dot(centred, centred), u.darkness), 0, 1);
    return k.vec4(
        k.mix(k.swizzle(u.color, 'rgb'), k.vec3(0, 0, 0), amount),
        k.swizzle(u.color, 'a')
    );
}
