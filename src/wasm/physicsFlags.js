/**
 * Bit flags forwarded from the main thread into the WASM DicePhysicsEngine.
 * The worker never parses URLs — only the main thread reads location.search.
 */

/** Disable per-die quadratic air resistance (matches ?no-drag). */
export const PHYSICS_FLAG_NO_DRAG = 1 << 0;

/**
 * @param {URLSearchParams} searchParams
 * @returns {number} u32 flag bits for DicePhysicsEngine.setFlags()
 */
export function parsePhysicsFlags(searchParams) {
    let flags = 0;
    if (searchParams.has('no-drag')) flags |= PHYSICS_FLAG_NO_DRAG;
    return flags >>> 0;
}
