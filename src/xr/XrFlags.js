/**
 * URL flags for the WebXR table path.
 *
 * | Flag            | Meaning                                                         |
 * | --------------- | --------------------------------------------------------------- |
 * | `?xr`           | seated `immersive-vr` (WebGL, no-post, `xrCompatible`)          |
 * | `?xr-emulator`  | alias of `?xr`                                                  |
 * | `?ar`           | `immersive-ar` table placement (implies everything `?xr` does)  |
 * | `?xr-webgpu`    | experimental: keep `WebGPURenderer` and try its `renderer.xr`   |
 * | `?xr-hands=off` | do not request `hand-tracking` (controllers only)               |
 * | `?xr-snap=45`   | snap-turn degrees (15–90)                                        |
 *
 * Every module that needs "is XR on" asks {@link isXrRequested} — never
 * `params.has('xr')` by hand, or `?ar` silently misses the WebGL / no-post /
 * quality-profile decisions.
 */

/** @param {URLSearchParams} [searchParams] */
function params(searchParams) {
    return searchParams ?? new URLSearchParams(window.location.search);
}

/**
 * `?ar` — `immersive-ar` placement on a hit-tested surface.
 * @param {URLSearchParams} [searchParams]
 * @returns {boolean}
 */
export function isArRequested(searchParams) {
    return params(searchParams).has('ar');
}

/**
 * `?xr-webgpu` — experimental. Keeps `WebGPURenderer` (no forced WebGL) and
 * hands its `renderer.xr` to the session. Three r181's XRManager still refuses
 * a WebGPU backend at `setSession`, so today this surfaces that error instead
 * of presenting; the default XR path stays WebGL.
 * @param {URLSearchParams} [searchParams]
 * @returns {boolean}
 */
export function isXrWebGpuRequested(searchParams) {
    return params(searchParams).has('xr-webgpu');
}

/**
 * Any XR path at all (VR, emulator alias, AR, or the WebGPU experiment).
 * @param {URLSearchParams} [searchParams]
 * @returns {boolean}
 */
export function isXrRequested(searchParams) {
    const p = params(searchParams);
    return p.has('xr') || p.has('xr-emulator') || p.has('ar') || p.has('xr-webgpu');
}

/**
 * Whether the XR path must force the classic `WebGLRenderer` (everything but
 * the `?xr-webgpu` experiment).
 * @param {URLSearchParams} [searchParams]
 * @returns {boolean}
 */
export function isXrWebGlForced(searchParams) {
    const p = params(searchParams);
    return isXrRequested(p) && !isXrWebGpuRequested(p);
}

/**
 * `hand-tracking` is requested as an optional feature unless `?xr-hands=off`.
 * @param {URLSearchParams} [searchParams]
 * @returns {boolean}
 */
export function isXrHandsEnabled(searchParams) {
    const raw = params(searchParams).get('xr-hands');
    return raw == null || !['off', '0', 'false', 'no'].includes(raw.toLowerCase());
}

/**
 * @param {URLSearchParams} [searchParams]
 * @returns {'immersive-ar' | 'immersive-vr'}
 */
export function getXrSessionMode(searchParams) {
    return isArRequested(searchParams) ? 'immersive-ar' : 'immersive-vr';
}

/**
 * Snap-turn angle in degrees. Default 45. `?xr-snap=30` overrides (clamped 15–90).
 * @param {URLSearchParams} [searchParams]
 * @returns {number}
 */
export function getXrSnapDegrees(searchParams) {
    const raw = Number.parseFloat(params(searchParams).get('xr-snap') ?? '45');
    if (!Number.isFinite(raw) || raw <= 0) return 45;
    return Math.min(90, Math.max(15, raw));
}
