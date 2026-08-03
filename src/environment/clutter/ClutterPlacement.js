import { resolveTableLayoutConfig } from '../../core/TableLayoutConfig.js';
import { shuffleWithRng } from '../../core/SeededRng.js';

/** Half-extent of the velvet dice zone (16×16 table center). */
export const DICE_ZONE_HALF = 8;

/** Usable tabletop half-extent (36×36 table, inset from lips). */
export const TABLE_HALF = 17;

/** Minimum clearance from dice spawn center (±2) and zone edge. */
const DICE_SPAWN_MARGIN = 3;

const RESERVED_ZONES = [
    { x: -2, z: -6, radius: 1.6 }, // candle (always)
    { x: -6, z: -3, radius: 2.2 }, // TarotDeck (tier0, spawned after clutter)
];

function isReserved(x, z) {
    return RESERVED_ZONES.some((zone) => {
        const dx = x - zone.x;
        const dz = z - zone.z;
        return dx * dx + dz * dz < zone.radius * zone.radius;
    });
}

function isInDiceZone(x, z) {
    return Math.abs(x) < DICE_ZONE_HALF && Math.abs(z) < DICE_ZONE_HALF;
}

function isNearDiceSpawn(x, z) {
    return Math.abs(x) < DICE_SPAWN_MARGIN && Math.abs(z) < DICE_SPAWN_MARGIN;
}

export function generateClutterSlots(count, rng) {
    const candidates = [];
    const step = 3.5;

    for (let x = -14; x <= 14; x += step) {
        for (let z = -14; z <= 14; z += step) {
            if (isInDiceZone(x, z)) continue;
            if (isNearDiceSpawn(x, z)) continue;
            if (isReserved(x, z)) continue;
            if (Math.abs(x) > TABLE_HALF - 1 || Math.abs(z) > TABLE_HALF - 1) continue;

            const jitterX = (rng() - 0.5) * 0.8;
            const jitterZ = (rng() - 0.5) * 0.8;
            candidates.push({
                x: x + jitterX,
                z: z + jitterZ,
                rotationY: rng() * Math.PI * 2,
            });
        }
    }

    shuffleWithRng(candidates, rng);
    return candidates.slice(0, count);
}

export function resolvePlacement(options, defaults) {
    const placement = options?.placement;
    const rng = options?.rng ?? Math.random;

    return {
        x: placement?.x ?? defaults.x,
        z: placement?.z ?? defaults.z,
        rotationY: placement?.rotationY ?? rng() * Math.PI * 2,
    };
}

export function resolveClutterOptions(searchParams = null, rng = Math.random) {
    const config = resolveTableLayoutConfig(searchParams, rng);
    return {
        count: config.clutterCount,
        seed: config.seed,
        theme: config.theme,
    };
}
