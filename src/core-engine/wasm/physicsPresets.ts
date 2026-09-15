import type { PhysicsPreset } from '../../types/physicsPresets.js';
import type { DieShapeId } from '../dice/DiceSetFormat.js';

/** Gravity used by `DicePhysicsEngine::init` and the visual tavern. */
export const PHYSICS_GRAVITY = -15;

/**
 * Physics-plane Y forwarded to `engine.init`. Visual tabletop is
 * `THROW_TABLE_SURFACE_Y`; the solver table still uses the historic -2.75.
 */
export const PHYSICS_TABLE_Y = -2.75;

/** Half-extents of the WASM table box (matches Table.js 36×36). */
export const PHYSICS_TABLE_HALF = 18;

/** Spawn / throw height reference used by `seededThrowParams`. */
export const THROW_TABLE_SURFACE_Y = 1.0;

export const DIE_PHYSICS_PRESETS: Record<DieShapeId, PhysicsPreset> = {
    d4: { mass: 5, friction: 0.85, rollingFriction: 0.35, dragFactor: 0.0024 },
    d6: { mass: 5, friction: 0.6, rollingFriction: 0.1, dragFactor: 0.002 },
    d8: { mass: 5, friction: 0.55, rollingFriction: 0.08, dragFactor: 0.0019 },
    d10: { mass: 5, friction: 0.5, rollingFriction: 0.06, dragFactor: 0.0018 },
    d12: { mass: 5, friction: 0.45, rollingFriction: 0.05, dragFactor: 0.0017 },
    d20: { mass: 5, friction: 0.4, rollingFriction: 0.03, dragFactor: 0.0016 },
};

export function getDieSides(type: string): number {
    return Number.parseInt(type.replace('d', ''), 10) || 6;
}

export function presetForShape(shape: string): PhysicsPreset {
    if (shape in DIE_PHYSICS_PRESETS) {
        return DIE_PHYSICS_PRESETS[shape as DieShapeId];
    }
    return DIE_PHYSICS_PRESETS.d6;
}
