/**
 * Minimal rAF tween for self-contained interaction feedback (card flips, prop
 * pulses). Deliberately standalone so interactables don't need to register a
 * per-frame system in the FrameScheduler for one-off animations.
 */
export function tween({ duration = 300, onUpdate, onComplete, easing = easeInOutQuad } = {}) {
    const start = performance.now();
    function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const e = easing(t);
        onUpdate?.(e, t);
        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            onComplete?.();
        }
    }
    requestAnimationFrame(frame);
}

export function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
