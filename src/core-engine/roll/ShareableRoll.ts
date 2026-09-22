import { DIE_SHAPE_IDS, DIE_TYPE_CATALOG, type DiceSet } from '../dice/DiceSetFormat.js';
import {
    LEGACY_LOOK_PARAM,
    LEGACY_LOOK_PARAM_ALIAS,
    diceSetFromLegacyLook,
} from '../dice/LegacyDiceLook.js';
import { DICE_SET_PARAM, decodeDiceSet, encodeDiceSet } from '../dice/ShareableDiceSet.js';
import { getGlobalLocation, getSubtleCrypto } from '../runtimeEnv.js';

/**
 * Highest URL replay format version this build writes or reads.
 *
 * v1: `?seed=` replays a thrown roll.
 * v2: adds `?src=`, the gameplay path that produced the roll — a tower dump
 *     is a different set of poses from the same seed, so a v1 client must not
 *     silently replay one as a throw.
 *
 * Bump when solver/throw semantics change.
 */
export const REPLAY_VERSION = 2;

/** Every version this build can still replay. Older links keep working. */
export const SUPPORTED_REPLAY_VERSIONS: readonly number[] = [1, 2];

/** Query param carrying the gameplay path a shared roll came from. */
export const ROLL_SOURCE_PARAM = 'src';

/** The roll sources a share link can name. */
export const ROLL_SOURCES = ['throw', 'tower'] as const;
export type RollSource = (typeof ROLL_SOURCES)[number];

export const DEFAULT_ROLL_SOURCE: RollSource = 'throw';

/**
 * The oldest format version that can express each source. A plain throw still
 * writes `v=1`, so links shared before `src` existed — and links shared by
 * this build to clients that predate it — keep replaying; only the sources
 * that genuinely need the new param carry the new version.
 */
const MIN_VERSION_FOR_SOURCE: Record<RollSource, number> = {
    throw: 1,
    tower: 2,
};

export function parseRollSource(raw: string | null | undefined): RollSource | null {
    const trimmed = raw?.trim();
    if (!trimmed) return null;
    return (ROLL_SOURCES as readonly string[]).includes(trimmed) ? (trimmed as RollSource) : null;
}

/**
 * Die keys a shared roll can carry, derived from the catalog rather than listed.
 *
 * The shapes come first so an existing link keeps its ordering, but a derived
 * type is just as rollable — a `4dF` roll has to survive a share link, and would
 * silently serialise to nothing if this stayed a hand-written list of hulls.
 */
export const DICE_TYPES = [
    ...DIE_SHAPE_IDS,
    ...Object.keys(DIE_TYPE_CATALOG).filter(
        (key) => !(DIE_SHAPE_IDS as readonly string[]).includes(key)
    ),
] as const;

export type DiceType = string;

export type DiceCounts = Record<string, number>;

export interface ShareableRollParams {
    seed: number;
    diceCounts: DiceCounts | null;
    expression: string | null;
    system: string | null;
    source: RollSource;
    version: number;
}

export interface UnsupportedShareableRollVersion {
    error: 'unsupported_version';
    version: number | null;
    seed: number;
}

export interface ShareableRollExtras {
    expression?: string | null;
    system?: string | null;
    /** Defaults to `'throw'`; `'tower'` replays the roll as a dice-tower dump. */
    source?: string | null;
}

/** Unsigned 32-bit roll seed. */
export function generateRollSeed(): number {
    const crypto = getSubtleCrypto();
    if (crypto?.getRandomValues) {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return (buf[0] ?? 0) >>> 0;
    }
    return (Math.random() * 0xffffffff) >>> 0;
}

/** e.g. `d20:1,d6:2` */
export function serializeDiceCounts(counts: Partial<Record<string, number>>): string {
    return DICE_TYPES.filter((type) => (counts[type] ?? 0) > 0)
        .map((type) => `${type}:${counts[type]}`)
        .join(',');
}

export function parseDiceParam(raw: string | null | undefined): DiceCounts | null {
    if (!raw?.trim()) return null;

    const counts = Object.fromEntries(DICE_TYPES.map((type) => [type, 0])) as DiceCounts;
    let named = 0;
    for (const part of raw.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const colon = trimmed.indexOf(':');
        if (colon < 0) continue;
        const type = trimmed.slice(0, colon).trim();
        const count = Number.parseInt(trimmed.slice(colon + 1), 10);
        if (
            !(DICE_TYPES as readonly string[]).includes(type) ||
            !Number.isFinite(count) ||
            count < 0
        )
            continue;
        counts[type] = Math.min(10, count);
        named++;
    }

    if (named === 0) return null;
    const total = DICE_TYPES.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
    return total > 0 ? counts : null;
}

export function parseShareableRollParams(
    searchParams: URLSearchParams
): ShareableRollParams | UnsupportedShareableRollVersion | null {
    const seedRaw = searchParams.get('seed');
    if (seedRaw === null || seedRaw === '') return null;

    const seed = Number.parseInt(seedRaw, 10);
    if (!Number.isFinite(seed)) return null;

    const versionRaw = searchParams.get('v');
    const version =
        versionRaw === null || versionRaw === '' ? null : Number.parseInt(versionRaw, 10);

    if (version === null || !SUPPORTED_REPLAY_VERSIONS.includes(version)) {
        return { error: 'unsupported_version', version, seed: seed >>> 0 };
    }

    // `src` only means anything from v2 on: a v1 link predates the param, so
    // it can only ever have described a throw, whatever else is on the URL.
    const source =
        version >= MIN_VERSION_FOR_SOURCE.tower
            ? (parseRollSource(searchParams.get(ROLL_SOURCE_PARAM)) ?? DEFAULT_ROLL_SOURCE)
            : DEFAULT_ROLL_SOURCE;

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
        source,
        version,
    };
}

/**
 * Build a link that replays a roll, carrying the dice it was rolled with.
 *
 * Appearance travels as `?dice-set=` — the whole descriptor, hashed — rather
 * than the v0 `?dice-look=` triple, so a shared link reproduces markings and
 * numbering, not just two colours. Old links are still read (see
 * `parseShareableRollDiceSet`); none are written.
 */
export function buildShareableRollUrl(
    seed: number,
    counts: Partial<Record<string, number>>,
    baseUrl?: string,
    diceSet: DiceSet | null = null,
    extras: ShareableRollExtras = {}
): string {
    const url = new URL(baseUrl ?? getGlobalLocation()?.href ?? 'http://localhost/');
    const source = parseRollSource(extras.source) ?? DEFAULT_ROLL_SOURCE;
    url.searchParams.set('seed', String(seed >>> 0));
    url.searchParams.set('v', String(MIN_VERSION_FOR_SOURCE[source]));
    if (source === DEFAULT_ROLL_SOURCE) url.searchParams.delete(ROLL_SOURCE_PARAM);
    else url.searchParams.set(ROLL_SOURCE_PARAM, source);
    const dice = serializeDiceCounts(counts ?? {});
    if (dice) url.searchParams.set('dice', dice);
    else url.searchParams.delete('dice');

    if (diceSet) url.searchParams.set(DICE_SET_PARAM, encodeDiceSet(diceSet));
    else url.searchParams.delete(DICE_SET_PARAM);
    url.searchParams.delete(LEGACY_LOOK_PARAM);
    url.searchParams.delete(LEGACY_LOOK_PARAM_ALIAS);

    const expression = extras.expression?.trim();
    if (expression) url.searchParams.set('expr', expression);
    else url.searchParams.delete('expr');

    const system = extras.system?.trim();
    if (system) url.searchParams.set('sys', system);
    else url.searchParams.delete('sys');

    return url.toString();
}

/**
 * The dice a shared roll was made with: the v1 descriptor when the link has one,
 * otherwise the v0 short code lifted into a set, otherwise nothing.
 */
export function parseShareableRollDiceSet(searchParams: URLSearchParams): DiceSet | null {
    return (
        decodeDiceSet(searchParams.get(DICE_SET_PARAM)) ??
        diceSetFromLegacyLook(
            searchParams.get(LEGACY_LOOK_PARAM) ?? searchParams.get(LEGACY_LOOK_PARAM_ALIAS)
        )
    );
}
