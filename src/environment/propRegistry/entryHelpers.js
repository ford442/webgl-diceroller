import { LAMP_HANG_Y, toCurrentTabletopY } from '../../core/SceneMetrics.js';

/**
 * @template {object} T
 * @param {string} name
 * @param {T} [options]
 * @returns {{name: string, factoryName?: string, randomPool?: boolean, position?: {x: number, y: number, z: number}} & T}
 */
export const factoryEntry = (name, options) => ({ name, .../** @type {any} */ (options ?? {}) });

export const tier1Position = { x: 0, y: LAMP_HANG_Y, z: 0 };

export const isLegacyTabletopPosition = (position) => position.y > -3.25 && position.y < -1.5;

export const resolveEntryPosition = (entry) =>
    entry.tabletop === true ||
    (entry.tabletop !== false && isLegacyTabletopPosition(entry.position))
        ? toCurrentTabletopY(entry.position)
        : entry.position;
