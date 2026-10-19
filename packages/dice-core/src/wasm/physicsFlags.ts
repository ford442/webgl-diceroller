/**
 * Flags forwarded from the main thread into the WASM DicePhysicsEngine.
 * The worker never parses URLs — only the main thread reads location.search.
 */

/** Disable per-die quadratic air resistance (matches ?no-drag). */
export const PHYSICS_FLAG_NO_DRAG = 1 << 0;

/** Disable the pipping centre-of-mass bias (matches ?fair-dice). */
export const PHYSICS_FLAG_FAIR_DICE = 1 << 1;

/**
 * Default pipping bias: the die's centre of mass sits this fraction of its
 * height toward the "1" face. The engine derives the offset itself from the
 * die's face table and hull (DicePhysicsEngine::deriveComAxis).
 */
export const DEFAULT_MASS_BIAS_RATIO = 0.0075;

/** Upper clamp for `?bias-ratio=` — mirrors MAX_MASS_BIAS_RATIO in the engine. */
export const MAX_MASS_BIAS_RATIO = 0.05;

/** u32 flag bits for DicePhysicsEngine.setFlags() */
export function parsePhysicsFlags(searchParams: URLSearchParams): number {
    let flags = 0;
    if (searchParams.has('no-drag')) flags |= PHYSICS_FLAG_NO_DRAG;
    if (searchParams.has('fair-dice')) flags |= PHYSICS_FLAG_FAIR_DICE;
    return flags >>> 0;
}

/** `?bias-ratio=` for DicePhysicsEngine.setMassBiasRatio(), clamped to [0, 0.05]. */
export function parseMassBiasRatio(searchParams: URLSearchParams): number {
    const raw = searchParams.get('bias-ratio');
    if (raw === null) return DEFAULT_MASS_BIAS_RATIO;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value)
        ? Math.max(0, Math.min(value, MAX_MASS_BIAS_RATIO))
        : DEFAULT_MASS_BIAS_RATIO;
}
