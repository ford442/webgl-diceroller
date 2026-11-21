/**
 * Pinch detection for tracked hands: thumb tip ↔ index tip distance with
 * hysteresis, so a pinch held at the threshold does not chatter grab/release.
 * Pure (plain `{ x, y, z }`), shared by XrHands and its unit test.
 *
 * Thresholds follow three's own hand pinch (2 cm ± 5 mm), slightly widened on
 * release: a die held in a pinch tugs the fingers apart a little.
 */

export const PINCH_START_M = 0.018;
export const PINCH_END_M = 0.032;
/** A pinch grabs the nearest die whose centre is within this of the pinch point. */
export const PINCH_REACH_M = 0.07;

/**
 * @returns {{ pinching: boolean }}
 */
export function createPinchState() {
    return { pinching: false };
}

/**
 * @param {{ pinching: boolean }} state
 * @param {number | null} distance thumb-tip ↔ index-tip, meters; null = joints not tracked
 * @returns {'start' | 'end' | null}
 */
export function updatePinch(state, distance) {
    if (distance == null || !Number.isFinite(distance)) {
        // Lost tracking mid-pinch counts as a release (never a stuck grab).
        if (state.pinching) {
            state.pinching = false;
            return 'end';
        }
        return null;
    }
    if (!state.pinching && distance <= PINCH_START_M) {
        state.pinching = true;
        return 'start';
    }
    if (state.pinching && distance >= PINCH_END_M) {
        state.pinching = false;
        return 'end';
    }
    return null;
}

/**
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 */
export function distance3(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Nearest candidate within `reach` of `point`, or null. Candidates carry
 * their world position and a bounding radius (meters) so a big d20 is as
 * easy to pinch as a small d4.
 * @template T
 * @param {{ x: number, y: number, z: number }} point
 * @param {Array<{ item: T, position: { x: number, y: number, z: number }, radius?: number }>} candidates
 * @param {number} [reach]
 * @returns {T | null}
 */
export function nearestWithinReach(point, candidates, reach = PINCH_REACH_M) {
    /** @type {T | null} */
    let best = null;
    let bestGap = Infinity;
    for (const c of candidates) {
        const gap = distance3(point, c.position) - (c.radius ?? 0);
        if (gap <= reach && gap < bestGap) {
            best = c.item;
            bestGap = gap;
        }
    }
    return best;
}
