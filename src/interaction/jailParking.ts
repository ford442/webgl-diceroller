/**
 * Where the jail parks a held die. Pure geometry, in the jail's local frame,
 * so the layout has a unit test and the controller only does the world-space
 * conversion and the engine calls.
 *
 * Slots, not "the nth die held this turn": a game sets dice aside one scoring
 * group at a time, and a die held on the second set-aside must not land on top
 * of one held on the first. A die keeps its slot until it is released.
 */

/** Parking places around the jail; a table never holds more dice than this. */
export const JAIL_PARKING_SLOTS = 8;

/**
 * Centre-to-centre distance between neighbouring parked dice. A d6 is 2.08
 * across and a d8 2.54 (public/wasm/hulls.json), so this keeps a d6 or d10
 * clear of its neighbours and a d8 only just touching — kinematic dice never
 * collide with each other, so a touch is cosmetic.
 */
export const JAIL_PARKING_SPACING = 2.2;

/** Local height of a parked die's centre: a d6 (half-height 1.04) resting on the table. */
export const JAIL_PARKING_Y = 1.1;

export interface JailParkingLayout {
    /** Jail-local centre of the interior, x/z. */
    center: { x: number; z: number };
    /** Smallest ring the jail's own interior suggests; the spacing floor may widen it. */
    minRadius: number;
}

/**
 * The ring radius that gives `JAIL_PARKING_SPACING` between neighbouring slots
 * (chord of a regular n-gon: 2·r·sin(π/n)).
 */
export function jailParkingRadius(minRadius = 0): number {
    const ring = JAIL_PARKING_SPACING / (2 * Math.sin(Math.PI / JAIL_PARKING_SLOTS));
    return Math.max(minRadius, ring);
}

/** Jail-local pose of parking slot `slot` (wraps, so a bad slot still lands somewhere). */
export function jailParkingPose(
    slot: number,
    layout: JailParkingLayout
): { x: number; y: number; z: number } {
    const n = JAIL_PARKING_SLOTS;
    const wrapped = ((Math.trunc(slot) % n) + n) % n;
    const angle = (wrapped / n) * Math.PI * 2;
    const radius = jailParkingRadius(layout.minRadius);
    return {
        x: layout.center.x + Math.cos(angle) * radius,
        y: JAIL_PARKING_Y,
        z: layout.center.z + Math.sin(angle) * radius,
    };
}

/** The lowest parking slot not in `taken`, or null when the ring is full. */
export function nextFreeParkingSlot(taken: Iterable<number>): number | null {
    const used = new Set(taken);
    for (let slot = 0; slot < JAIL_PARKING_SLOTS; slot++) {
        if (!used.has(slot)) return slot;
    }
    return null;
}
