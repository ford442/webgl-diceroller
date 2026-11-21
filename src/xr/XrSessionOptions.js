/**
 * `XRSessionInit` for the two session modes. Pure so a unit test pins what we
 * ask the browser for.
 *
 * Nothing is *required* beyond the mode itself: a Quest without hand tracking
 * enabled, or an emulator without hit-test, must still start a session (we
 * fall back to controllers / a fixed placement in front of the player).
 */

/**
 * @param {'immersive-vr' | 'immersive-ar'} mode
 * @param {{ hands?: boolean }} [options]
 * @returns {{ requiredFeatures: string[], optionalFeatures: string[] }}
 */
export function buildXrSessionInit(mode, { hands = true } = {}) {
    const optionalFeatures = ['local-floor'];
    if (mode === 'immersive-ar') {
        optionalFeatures.push('hit-test', 'anchors');
    } else {
        optionalFeatures.push('bounded-floor');
    }
    if (hands) optionalFeatures.push('hand-tracking');
    // Three uses XRProjectionLayer when 'layers' is granted (fixed foveation
    // on Quest goes through it). No polyfill or extra library involved.
    optionalFeatures.push('layers');
    return { requiredFeatures: [], optionalFeatures };
}

/**
 * Label for the DOM entry button.
 * @param {'immersive-vr' | 'immersive-ar'} mode
 * @param {boolean} presenting
 */
export function xrButtonLabel(mode, presenting) {
    const noun = mode === 'immersive-ar' ? 'AR' : 'VR';
    return presenting ? `Exit ${noun}` : `Enter ${noun}`;
}
