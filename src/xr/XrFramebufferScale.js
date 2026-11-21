/**
 * Framebuffer scale for the XR layer, driven by `QUALITY_PROFILES.xr`.
 *
 * WebXR fixes the layer size when the session starts (three warns and ignores
 * `setFramebufferScaleFactor` while presenting), so this works like the
 * desktop pixel-ratio monitor one step removed: frames are sampled during a
 * session, a sustained-slow window lowers the *next* session's scale by one
 * step, and the value is applied right before `renderer.xr.setSession`.
 *
 * Frame budget: Quest's lowest refresh is 72 Hz (13.9 ms). A window whose
 * mean frame time is over {@link XR_SLOW_FRAME_MS} — a frame-and-a-half — is
 * "slow"; {@link XR_SLOW_WINDOWS} of those in a row step the scale down.
 */

import { QUALITY_PROFILES } from '../core/AdaptiveQuality.js';

export const XR_SLOW_FRAME_MS = 21;
export const XR_SAMPLE_WINDOW = 90;
export const XR_SLOW_WINDOWS = 2;

/**
 * @typedef {{
 *   framebufferScale?: number,
 *   framebufferScaleMin?: number,
 *   framebufferScaleStep?: number,
 *   foveation?: number,
 * }} XrQualityProfile
 */

/**
 * @param {XrQualityProfile} [profile]
 */
export function createXrFramebufferScaleMonitor(profile = QUALITY_PROFILES.xr) {
    const initial = clampScale(profile.framebufferScale ?? 1);
    const min = clampScale(Math.min(initial, profile.framebufferScaleMin ?? 0.6));
    const step = Math.max(0.01, profile.framebufferScaleStep ?? 0.1);
    const foveation = Math.min(1, Math.max(0, profile.foveation ?? 1));

    /** Scale the current (or last) session started with. */
    let activeScale = initial;
    /** Scale the next session will start with. */
    let nextScale = initial;
    let windowMs = 0;
    let windowFrames = 0;
    let slowWindows = 0;
    let stepDowns = 0;
    let lastWindowAvgMs = 0;

    function resetWindow() {
        windowMs = 0;
        windowFrames = 0;
    }

    return {
        /**
         * Call right before `setSession`. Returns what was applied.
         * @param {{ setFramebufferScaleFactor?: (v: number) => void, setFoveation?: (v: number) => void } | null | undefined} xrManager
         */
        applyBeforeSession(xrManager) {
            activeScale = nextScale;
            xrManager?.setFramebufferScaleFactor?.(activeScale);
            xrManager?.setFoveation?.(foveation);
            resetWindow();
            slowWindows = 0;
            return { framebufferScale: activeScale, foveation };
        },
        /**
         * Feed one presented frame. Returns true when this frame lowered the
         * next session's scale.
         * @param {number} deltaSeconds
         */
        sample(deltaSeconds) {
            const ms = deltaSeconds * 1000;
            // Ignore hitches (tab switch, session-start stall) and zero deltas.
            if (!(ms > 0) || ms > 250) return false;
            windowMs += ms;
            windowFrames += 1;
            if (windowFrames < XR_SAMPLE_WINDOW) return false;
            lastWindowAvgMs = windowMs / windowFrames;
            resetWindow();
            if (lastWindowAvgMs <= XR_SLOW_FRAME_MS) {
                slowWindows = 0;
                return false;
            }
            slowWindows += 1;
            if (slowWindows < XR_SLOW_WINDOWS) return false;
            slowWindows = 0;
            const lowered = clampScale(Math.max(min, round2(nextScale - step)));
            if (lowered >= nextScale) return false;
            nextScale = lowered;
            stepDowns += 1;
            return true;
        },
        getStats() {
            return {
                framebufferScale: activeScale,
                nextFramebufferScale: nextScale,
                minFramebufferScale: min,
                foveation,
                lastWindowAvgMs: round2(lastWindowAvgMs),
                stepDowns,
            };
        },
    };
}

/** @param {number} v */
function clampScale(v) {
    if (!Number.isFinite(v)) return 1;
    return Math.min(2, Math.max(0.25, v));
}

/** @param {number} v */
function round2(v) {
    return Math.round(v * 100) / 100;
}
