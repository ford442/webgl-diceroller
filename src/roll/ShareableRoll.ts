import type { DiceSet } from '../dice/DiceSetFormat.js';
import {
    LEGACY_LOOK_PARAM,
    LEGACY_LOOK_PARAM_ALIAS,
    diceSetFromLegacyLook,
} from '../dice/LegacyDiceLook.js';
import { DICE_SET_PARAM, decodeDiceSet, encodeDiceSet } from '../dice/ShareableDiceSet.js';

/** URL replay format version — bump when solver/throw semantics change. */
export const REPLAY_VERSION = 1;

export const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;

export type DiceType = (typeof DICE_TYPES)[number];

export type DiceCounts = Record<DiceType, number>;

export interface ShareableRollParams {
    seed: number;
    diceCounts: DiceCounts | null;
    expression: string | null;
    system: string | null;
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
}

/** Unsigned 32-bit roll seed. */
export function generateRollSeed(): number {
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] >>> 0;
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
    for (const part of raw.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const colon = trimmed.indexOf(':');
        if (colon < 0) continue;
        const type = trimmed.slice(0, colon).trim();
        const count = Number.parseInt(trimmed.slice(colon + 1), 10);
        if (!DICE_TYPES.includes(type as DiceType) || !Number.isFinite(count) || count < 0)
            continue;
        counts[type as DiceType] = Math.min(10, count);
    }

    const total = DICE_TYPES.reduce((sum, type) => sum + counts[type], 0);
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
        version: REPLAY_VERSION,
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
    const url = new URL(
        baseUrl ?? (typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
    );
    url.searchParams.set('seed', String(seed >>> 0));
    url.searchParams.set('v', String(REPLAY_VERSION));
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
