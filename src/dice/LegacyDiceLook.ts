/**
 * The v0 `?dice-look=` short code, kept alive as a *decoder*.
 *
 * v1 links carry `?dice-set=` (see `ShareableDiceSet`). Links minted before that
 * carry a compact per-type triple instead — `d6:r:c43c3c:fff8ef` — and they must
 * still tint the table, so this module parses that token back onto a `DiceSet`.
 * Encoding is kept only so the old token can be round-tripped in tests and by
 * anything still writing v0 links; new share URLs should not emit it.
 *
 * Dependency-free: share encoding must not drag the renderer into its graph.
 */

import {
    MATERIAL_PRESET_IDS,
    createDefaultDiceSet,
    normalizeHexColor,
    withComputedId,
    type DiceSet,
    type MaterialPresetId,
} from './DiceSetFormat.js';

/** The v0 query parameter. `look` was an even earlier spelling of the same thing. */
export const LEGACY_LOOK_PARAM = 'dice-look';
export const LEGACY_LOOK_PARAM_ALIAS = 'look';

/** Die types a v0 token could name — the shapes, and only the shapes. */
export const LEGACY_DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;

const PRESET_SHORT: Record<MaterialPresetId, string> = {
    resin: 'r',
    metal: 'm',
    gemstone: 'g',
    bone: 'b',
    obsidian: 'o',
    glow: 'l',
};

const PRESET_FROM_SHORT: Record<string, MaterialPresetId> = Object.fromEntries(
    Object.entries(PRESET_SHORT).map(([id, short]) => [short, id as MaterialPresetId])
);

export function presetToShortCode(presetId: string): string {
    return PRESET_SHORT[presetId as MaterialPresetId] ?? PRESET_SHORT.resin;
}

export function presetFromShortCode(code: string): MaterialPresetId {
    return PRESET_FROM_SHORT[code] ?? 'resin';
}

export interface LegacyLookEntry {
    preset: MaterialPresetId;
    bodyColor: string;
    markingColor: string;
}

/**
 * Parse a v0 token into per-type body/marking colours. Unknown types, short
 * segments and bad colours are skipped rather than failing the whole token.
 */
export function parseLegacyDiceLook(
    raw: string | null | undefined
): Record<string, LegacyLookEntry> | null {
    if (!raw?.trim()) return null;

    const out: Record<string, LegacyLookEntry> = {};
    for (const part of raw.split(',')) {
        const segments = part.trim().split(':');
        if (segments.length < 4) continue;
        const [type, preset, body, marking] = segments;
        if (!(LEGACY_DICE_TYPES as readonly string[]).includes(type)) continue;
        out[type] = {
            preset: presetFromShortCode(preset),
            bodyColor: normalizeHexColor(body, '#c43c3c'),
            markingColor: normalizeHexColor(marking, '#fff8ef'),
        };
    }

    return Object.keys(out).length ? out : null;
}

/** Overlay a decoded v0 token onto a set, leaving everything else untouched. */
export function applyLegacyDiceLook(
    set: DiceSet,
    look: Record<string, LegacyLookEntry> | null
): DiceSet {
    if (!look) return set;

    const dice = { ...set.dice };
    for (const [type, entry] of Object.entries(look)) {
        const base = dice[type];
        if (!base) continue;
        dice[type] = {
            ...base,
            body: {
                ...base.body,
                preset: MATERIAL_PRESET_IDS.includes(entry.preset)
                    ? entry.preset
                    : base.body.preset,
                bodyColor: entry.bodyColor,
                markingColor: entry.markingColor,
            },
        };
    }
    return withComputedId({ ...set, dice });
}

/** Decode a v0 token straight into a set, for links that carry nothing newer. */
export function diceSetFromLegacyLook(raw: string | null | undefined): DiceSet | null {
    const look = parseLegacyDiceLook(raw);
    return look ? applyLegacyDiceLook(createDefaultDiceSet(), look) : null;
}

/**
 * Re-emit the v0 token from a set. Only the shapes a v0 reader understands are
 * included, and only where the look differs from that reader's defaults.
 */
export function serializeLegacyDiceLook(set: DiceSet): string {
    const defaults = createDefaultDiceSet();
    return LEGACY_DICE_TYPES.map((type) => {
        const entry = set.dice[type];
        if (!entry) return null;
        const base = defaults.dice[type]?.body;
        if (
            base &&
            entry.body.preset === base.preset &&
            entry.body.bodyColor === base.bodyColor &&
            entry.body.markingColor === base.markingColor
        ) {
            return null;
        }
        const body = entry.body.bodyColor.replace('#', '');
        const marking = entry.body.markingColor.replace('#', '');
        return `${type}:${presetToShortCode(entry.body.preset)}:${body}:${marking}`;
    })
        .filter(Boolean)
        .join(',');
}
