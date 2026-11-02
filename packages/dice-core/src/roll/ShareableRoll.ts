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
 * v3: adds `?ids=`, the table slots a partial throw moved (a game re-throwing
 *     the dice it did not set aside). Without it a client throws every die, and
 *     the same seed draws a different pose for each one, so an older client must
 *     reject the link rather than replay it as a full throw.
 *
 * Bump when solver/throw semantics change.
 */
export const REPLAY_VERSION = 3;

/** Every version this build can still replay. Older links keep working. */
export const SUPPORTED_REPLAY_VERSIONS: readonly number[] = [1, 2, 3];

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

/**
 * Query param naming the dice a partial throw moved. Absent means "all of
 * them", which is what every link written before v3 meant.
 */
export const ROLL_IDS_PARAM = 'ids';

/** The oldest format version that can express an `ids` list. */
const MIN_VERSION_FOR_IDS = 3;

/** A sane ceiling on a table: 10 of each of the catalog's dice, with headroom. */
const MAX_ROLL_IDS = 128;

/**
 * A die on the wire is its **table slot**: its zero-based position in the dice
 * set, i.e. its index in `readAllDiceValues()` — the same order `?dice=` expands
 * in. It is deliberately not the physics body id, which the engine hands out
 * per session (a page that rolled before the replay has burned ids a fresh page
 * has not), so a link that carried body ids would name different dice on the
 * receiver.
 */
export type RollSlots = readonly number[];

/** `[5, 0, 2, 2]` → `0,2,5`; null when there is nothing partial to say. */
export function serializeRollIds(ids: RollSlots | null | undefined): string | null {
    if (!ids?.length) return null;
    const slots = [...new Set(ids)]
        .filter((n) => Number.isInteger(n) && n >= 0)
        .sort((a, b) => a - b);
    return slots.length ? slots.join(',') : null;
}

/** The slots an `ids` param names, ascending and unique; null reads as "all". */
export function parseRollIds(raw: string | null | undefined): number[] | null {
    if (!raw?.trim()) return null;
    const slots = new Set<number>();
    for (const part of raw.split(',')) {
        const trimmed = part.trim();
        if (!/^\d+$/.test(trimmed)) continue;
        const n = Number.parseInt(trimmed, 10);
        if (n < MAX_ROLL_IDS) slots.add(n);
    }
    return slots.size ? [...slots].sort((a, b) => a - b) : null;
}

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
    /** Table slots a partial throw moved; null = every die (all pre-v3 links). */
    ids: number[] | null;
    /**
     * Hash of the collider world the roll landed in (`w=`), or null on a link
     * that predates it. The receiver compares it with its own `worldHash()`
     * before replaying: a different table is a different simulation.
     */
    worldHash: string | null;
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
    /**
     * Table slots of a partial throw (see `RollSlots`). Absent or empty means
     * the roll moved every die. Written at v3, since an older client would
     * ignore it and throw them all.
     */
    ids?: RollSlots | null;
    /**
     * The table layout the roll landed on (TableLayoutConfig). Written as
     * `layout-seed` + `density` + `theme`, which the receiving page's layout
     * resolver already reads — all three, since a missing one falls back to
     * the *receiver's* stored preference. The clutter colliders
     * are part of the simulation, so a replay must rebuild the same table.
     * Older clients ignore the extra params, so the format version is unchanged.
     */
    layout?: { seed: number; density?: string | null; theme?: string | null } | null;
    /**
     * `hashWorld` of the table the roll landed on, written as `w=`. The layout
     * params say how to *build* the table; this says what the sender actually
     * built, so a receiver whose props or colliders differ (another app
     * version, a doctored position) can tell before it replays. Only
     * well-formed hashes are written; older clients ignore the param.
     */
    worldHash?: string | null;
}

/** Collider-world hash param of a share link (see ShareableRollExtras.worldHash). */
export const WORLD_HASH_PARAM = 'w';
const WORLD_HASH_PATTERN = /^[0-9a-f]{16}$/;

/** The hash if it is a well-formed `hashWorld` value, else null. */
export function parseWorldHash(raw: string | null | undefined): string | null {
    const value = raw?.trim().toLowerCase();
    return value && WORLD_HASH_PATTERN.test(value) ? value : null;
}

/** Layout params `buildShareableRollUrl` writes (see ShareableRollExtras.layout). */
export const LAYOUT_SEED_PARAM = 'layout-seed';
const DEFAULT_LAYOUT_DENSITY = 'med';
const DEFAULT_LAYOUT_THEME = 'default';

/** Unsigned 32-bit roll seed. */
export function generateRollSeed(): number {
    const crypto = getSubtleCrypto();
    if (crypto?.getRandomValues) {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return (buf[0] ?? 0) >>> 0;
    }
    // Only mints a *new* seed when no CSPRNG exists; the seed then travels in
    // the link, so replays never re-draw it.
    // eslint-disable-next-line no-restricted-properties
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

    // Same rule as `src`: a link older than the param cannot have meant it.
    const ids =
        version >= MIN_VERSION_FOR_IDS ? parseRollIds(searchParams.get(ROLL_IDS_PARAM)) : null;

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
        ids,
        worldHash: parseWorldHash(searchParams.get(WORLD_HASH_PARAM)),
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
    const ids = serializeRollIds(extras.ids);
    url.searchParams.set(
        'v',
        String(Math.max(MIN_VERSION_FOR_SOURCE[source], ids ? MIN_VERSION_FOR_IDS : 0))
    );
    if (ids) url.searchParams.set(ROLL_IDS_PARAM, ids);
    else url.searchParams.delete(ROLL_IDS_PARAM);
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

    const layout = extras.layout;
    if (layout && Number.isFinite(layout.seed)) {
        url.searchParams.set(LAYOUT_SEED_PARAM, String(layout.seed >>> 0));
        url.searchParams.delete('clutter-seed');
        url.searchParams.set('density', layout.density?.trim() || DEFAULT_LAYOUT_DENSITY);
        url.searchParams.set('theme', layout.theme?.trim() || DEFAULT_LAYOUT_THEME);
    }

    const worldHash = parseWorldHash(extras.worldHash);
    if (worldHash) url.searchParams.set(WORLD_HASH_PARAM, worldHash);
    else url.searchParams.delete(WORLD_HASH_PARAM);

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
