/**
 * URL flags for the WebXR seated-table spike.
 * `?xr` and `?xr-emulator` both request the XR path (WebGL + no-post implied elsewhere).
 */

/**
 * @param {URLSearchParams} [searchParams]
 * @returns {boolean}
 */
export function isXrRequested(searchParams = new URLSearchParams(window.location.search)) {
    return searchParams.has('xr') || searchParams.has('xr-emulator');
}

/**
 * Snap-turn angle in degrees. Default 45. `?xr-snap=30` overrides (clamped 15–90).
 * @param {URLSearchParams} [searchParams]
 * @returns {number}
 */
export function getXrSnapDegrees(searchParams = new URLSearchParams(window.location.search)) {
    const raw = Number.parseFloat(searchParams.get('xr-snap') ?? '45');
    if (!Number.isFinite(raw) || raw <= 0) return 45;
    return Math.min(90, Math.max(15, raw));
}
