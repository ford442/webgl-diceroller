import { serializeDiceAppearance, parseDiceAppearanceParam } from '../dice/DiceAppearanceConfig.js';

/** URL replay format version — bump when solver/throw semantics change. */
export const REPLAY_VERSION = 1;

export const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

/** @returns {number} Unsigned 32-bit roll seed. */
export function generateRollSeed() {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] >>> 0;
    }
    return (Math.random() * 0xFFFFFFFF) >>> 0;
}

/**
 * @param {Record<string, number>} counts
 * @returns {string} e.g. `d20:1,d6:2`
 */
export function serializeDiceCounts(counts) {
    return DICE_TYPES
        .filter((type) => (counts[type] ?? 0) > 0)
        .map((type) => `${type}:${counts[type]}`)
        .join(',');
}

/**
 * @param {string} raw
 * @returns {Record<string, number>|null}
 */
export function parseDiceParam(raw) {
    if (!raw?.trim()) return null;

    const counts = Object.fromEntries(DICE_TYPES.map((type) => [type, 0]));
    for (const part of raw.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const colon = trimmed.indexOf(':');
        if (colon < 0) continue;
        const type = trimmed.slice(0, colon).trim();
        const count = Number.parseInt(trimmed.slice(colon + 1), 10);
        if (!DICE_TYPES.includes(type) || !Number.isFinite(count) || count < 0) continue;
        counts[type] = Math.min(10, count);
    }

    const total = DICE_TYPES.reduce((sum, type) => sum + counts[type], 0);
    return total > 0 ? counts : null;
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {{
 *   seed: number,
 *   diceCounts: Record<string, number>|null,
 *   expression: string|null,
 *   system: string|null,
 *   version: number
 * }|{ error: 'unsupported_version', version: number|null, seed: number }|null}
 */
export function parseShareableRollParams(searchParams) {
    const seedRaw = searchParams.get('seed');
    if (seedRaw === null || seedRaw === '') return null;

    const seed = Number.parseInt(seedRaw, 10);
    if (!Number.isFinite(seed)) return null;

    const versionRaw = searchParams.get('v');
    const version = versionRaw === null || versionRaw === ''
        ? null
        : Number.parseInt(versionRaw, 10);

    if (version !== REPLAY_VERSION) {
        return { error: 'unsupported_version', version, seed: seed >>> 0 };
    }

    const diceCounts = parseDiceParam(searchParams.get('dice') ?? '');
    const expressionRaw = searchParams.get('expr') ?? searchParams.get('expression');
    const expression = expressionRaw?.trim() ? expressionRaw.trim() : null;
    const systemRaw = searchParams.get('sys') ?? searchParams.get('system');
    const system = systemRaw?.trim() ? systemRaw.trim() : null;

    return {
        seed: seed >>> 0,
        diceCounts,
        expression,
        system,
        version: REPLAY_VERSION
    };
}

/**
 * @param {number} seed
 * @param {Record<string, number>} counts
 * @param {string} [baseUrl]
 * @param {Record<string, { preset: string, bodyColor: string, pipColor: string }>|null} [appearance]
 * @param {{ expression?: string|null, system?: string|null }} [extras]
 */
export function buildShareableRollUrl(seed, counts, baseUrl, appearance = null, extras = {}) {
    const url = new URL(baseUrl ?? (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'));
    url.searchParams.set('seed', String(seed >>> 0));
    url.searchParams.set('v', String(REPLAY_VERSION));
    const dice = serializeDiceCounts(counts ?? {});
    if (dice) url.searchParams.set('dice', dice);
    else url.searchParams.delete('dice');

    const look = appearance ? serializeDiceAppearance(appearance) : null;
    if (look) url.searchParams.set('dice-look', look);
    else url.searchParams.delete('dice-look');

    const expression = extras.expression?.trim();
    if (expression) url.searchParams.set('expr', expression);
    else url.searchParams.delete('expr');

    const system = extras.system?.trim();
    if (system) url.searchParams.set('sys', system);
    else url.searchParams.delete('sys');

    return url.toString();
}

export { parseDiceAppearanceParam, serializeDiceAppearance };
