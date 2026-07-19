/**
 * User accessibility preferences (OS media queries + URL overrides).
 */

export function prefersReducedMotion() {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has('reduced-motion')) return true;
    if (params.has('no-reduced-motion')) return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Result-card entrance duration (seconds); instant when reduced motion is on. */
export function resultCardTransitionSec() {
    return prefersReducedMotion() ? 0 : 0.3;
}

/** Stagger between result cards (ms). */
export function resultCardStaggerMs() {
    return prefersReducedMotion() ? 0 : 120;
}
