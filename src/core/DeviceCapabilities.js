const searchParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();

import { prefersReducedMotion } from './AccessibilityPrefs.js';

export function isTouchPrimaryDevice() {
    if (searchParams.has('touch')) return true;
    if (searchParams.has('no-touch')) return false;
    if (typeof window === 'undefined') return false;
    return (
        'ontouchstart' in window
        || navigator.maxTouchPoints > 0
        || window.matchMedia?.('(pointer: coarse)').matches === true
    );
}

export function prefersSquareDesktopLayout() {
    if (searchParams.has('square')) return true;
    if (searchParams.has('fill')) return false;
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;
}

export function collectDeviceQualityHints(rendererState = null) {
    const deviceDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const hardwareConcurrency = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4;
    const touchPrimary = isTouchPrimaryDevice();
    const maxTextureSize = rendererState?.renderer?.capabilities?.maxTextureSize ?? 4096;
    const isSoftwareRenderer = rendererState?.isSoftwareRenderer === true;
    const lowDpr = deviceDpr <= 1.25;
    const lowCores = hardwareConcurrency <= 4;
    const reducedMotion = prefersReducedMotion();

    return {
        deviceDpr,
        hardwareConcurrency,
        touchPrimary,
        maxTextureSize,
        isSoftwareRenderer,
        lowDpr,
        lowCores,
        reducedMotion
    };
}
