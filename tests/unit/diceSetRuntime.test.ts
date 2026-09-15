/**
 * The descriptor is what you see on the table: these cover the pure half of
 * that — the glyph plan, the shading parameters, the legacy decode and the
 * runtime's face-value resolution. The two material twins are exercised by the
 * render-regression baselines, not here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    bakedGlyphSetFor,
    canUseBakedMarkings,
    collectGlyphKeys,
    faceMarkingSignature,
    planFaceGlyphs,
} from '../../src/dice/DiceFaceGlyphs.js';
import {
    DICE_PRESET_PARAMS,
    INCLUSION_TYPE_INDEX,
    MARKING_STYLE_INDEX,
    diceShadingParams,
} from '../../src/dice/DiceShadingParams.js';
import {
    createDefaultDiceSet,
    createDefaultEntry,
    withComputedId,
    type DiceSetEntry,
} from '../../src/dice/DiceSetFormat.js';
import {
    applyLegacyDiceLook,
    diceSetFromLegacyLook,
    parseLegacyDiceLook,
    serializeLegacyDiceLook,
} from '../../src/dice/LegacyDiceLook.js';
import {
    getDieEntry,
    getDieShape,
    listDieKeys,
    resetDiceSetRuntimeForTests,
    resolveDieFaceValue,
    setActiveDiceSet,
    subscribeDiceSet,
    updateDieEntry,
} from '../../src/dice/DiceSetRuntime.js';

function entryWith(dieKey: string, patch: Partial<DiceSetEntry>): DiceSetEntry {
    return { ...createDefaultEntry(dieKey), ...patch };
}

describe('face glyph plan', () => {
    it('defaults to the numerals the shipped hulls actually carry', () => {
        expect(planFaceGlyphs(createDefaultEntry('d6')).map((g) => g.label)).toEqual([
            '1',
            '2',
            '3',
            '4',
            '5',
            '6',
        ]);
        expect(planFaceGlyphs(createDefaultEntry('d20'))[19]).toMatchObject({
            kind: 'text',
            label: '20',
            value: 20,
        });
    });

    it('plans a Fudge die from its sequence, not its face count', () => {
        const glyphs = planFaceGlyphs(createDefaultEntry('dF'));
        expect(glyphs.map((g) => g.value)).toEqual([-1, 0, 1, -1, 0, 1]);
        // Six faces, three distinct glyphs — the atlas only rasterises each once.
        expect(collectGlyphKeys(createDefaultEntry('dF'))).toHaveLength(3);
    });

    it('draws pips when the glyph set asks for them', () => {
        const pipD6 = entryWith('d6', {
            faces: { ...createDefaultEntry('d6').faces, glyphs: 'pips' },
        });
        expect(planFaceGlyphs(pipD6).map((g) => g.kind)).toEqual(Array(6).fill('pips'));
    });

    it('renders Fudge values as symbols when the glyph set asks for them', () => {
        const entry = entryWith('dF', {
            faces: { ...createDefaultEntry('dF').faces, glyphs: 'symbols' },
        });
        expect(planFaceGlyphs(entry).map((g) => g.label)).toEqual(['−', '–', '+', '−', '–', '+']);
    });

    it('falls back to numerals when a glyph set cannot express a value', () => {
        const pipD20 = entryWith('d20', {
            faces: { ...createDefaultEntry('d20').faces, glyphs: 'pips' },
        });
        const kinds = new Set(planFaceGlyphs(pipD20).map((g) => g.kind));
        // 1..9 can be pips; 10..20 has to be a numeral rather than nothing.
        expect(kinds).toEqual(new Set(['pips', 'text']));
    });

    it('underlines 6 and 9 only when asked, and only for numerals', () => {
        const base = createDefaultEntry('d20');
        const underlined = entryWith('d20', {
            faces: { ...base.faces, underlineSixNine: true },
        });
        const marked = planFaceGlyphs(underlined).filter((g) => g.underline);
        expect(marked.map((g) => g.value)).toEqual([6, 9]);
        expect(planFaceGlyphs(base).some((g) => g.underline)).toBe(false);
    });

    it('changes its signature when any marking input changes', () => {
        const base = createDefaultEntry('d6');
        const restyled = entryWith('d6', { faces: { ...base.faces, style: 'engraved' } });
        const renumbered = entryWith('d6', {
            numbering: { start: 7, step: 1, sequence: null },
        });
        expect(faceMarkingSignature(restyled)).not.toBe(faceMarkingSignature(base));
        expect(faceMarkingSignature(renumbered)).not.toBe(faceMarkingSignature(base));
        expect(faceMarkingSignature(createDefaultEntry('d6'))).toBe(faceMarkingSignature(base));
    });
});

describe('baked markings', () => {
    it('are used only when the descriptor asks for exactly what the mesh has', () => {
        expect(bakedGlyphSetFor('d6')).toBe('numerals');
        expect(canUseBakedMarkings(createDefaultEntry('d6'), true)).toBe(true);
        expect(canUseBakedMarkings(createDefaultEntry('d20'), true)).toBe(true);
        // a hull with nothing carved into it has nothing to offer
        expect(canUseBakedMarkings(createDefaultEntry('d6'), false)).toBe(false);
    });

    it('are rejected by any numbering or glyph the mesh cannot show', () => {
        const base = createDefaultEntry('d6');
        expect(canUseBakedMarkings(createDefaultEntry('dF'), true)).toBe(false);
        expect(
            canUseBakedMarkings(entryWith('d6', { faces: { ...base.faces, glyphs: 'pips' } }), true)
        ).toBe(false);
        expect(
            canUseBakedMarkings(entryWith('d6', { faces: { ...base.faces, font: 'serif' } }), true)
        ).toBe(false);
        expect(
            canUseBakedMarkings(
                entryWith('d6', { numbering: { start: 0, step: 1, sequence: null } }),
                true
            )
        ).toBe(false);
    });

    it('still leaves marking style to the descriptor', () => {
        // The point of the baked path: it decides *which glyphs*, never how they
        // are cut — so engraved/inlaid/painted must still differ.
        const base = createDefaultEntry('d6');
        const engraved = diceShadingParams(
            entryWith('d6', { faces: { ...base.faces, style: 'engraved' } })
        );
        const painted = diceShadingParams(
            entryWith('d6', { faces: { ...base.faces, style: 'painted' } })
        );
        expect(engraved.markingStyle).not.toBe(painted.markingStyle);
        expect(painted.markingDepth).toBe(0);
        expect(engraved.markingDepth).toBeGreaterThan(0);
    });
});

describe('shading parameters', () => {
    it('treats a preset as a starting point the spec overrides', () => {
        const entry = entryWith('d6', {
            body: {
                ...createDefaultEntry('d6').body,
                preset: 'metal',
                translucency: 0.5,
                inclusion: { type: 'galaxy', color: '#8899ff', intensity: 0.7 },
            },
        });
        const params = diceShadingParams(entry, { highQuality: true });
        expect(params.metalness).toBe(DICE_PRESET_PARAMS.metal.metalness);
        expect(params.transmission).toBeCloseTo(0.5);
        expect(params.inclusionType).toBe(INCLUSION_TYPE_INDEX.galaxy);
        expect(params.inclusionIntensity).toBeCloseTo(0.7);
    });

    it('composes translucency with a preset that already transmits', () => {
        const base = createDefaultEntry('d10');
        const opaqueGem = diceShadingParams(base, { highQuality: true });
        const translucentGem = diceShadingParams(
            entryWith('d10', { body: { ...base.body, translucency: 0.5 } }),
            { highQuality: true }
        );
        expect(opaqueGem.transmission).toBeCloseTo(DICE_PRESET_PARAMS.gemstone.transmission);
        expect(translucentGem.transmission).toBeGreaterThan(opaqueGem.transmission);
        expect(translucentGem.transmission).toBeLessThanOrEqual(1);
    });

    it('drops transmission on a profile that cannot afford it', () => {
        const params = diceShadingParams(createDefaultEntry('d10'), { highQuality: false });
        expect(params.transmission).toBe(0);
        expect(params.thickness).toBe(0);
        // …and falls back to a faux-gem clearcoat rather than a flat resin.
        expect(params.clearcoat).toBeGreaterThan(DICE_PRESET_PARAMS.gemstone.clearcoat);
    });

    it('maps every marking style to a distinct shader index', () => {
        expect(new Set(Object.values(MARKING_STYLE_INDEX)).size).toBe(3);
    });
});

describe('legacy dice-look decode', () => {
    it('round-trips a customized set through the v0 short code', () => {
        const set = createDefaultDiceSet();
        set.dice.d20 = {
            ...set.dice.d20,
            body: {
                ...set.dice.d20.body,
                preset: 'metal',
                bodyColor: '#112233',
                markingColor: '#aabbcc',
            },
        };
        const token = serializeLegacyDiceLook(withComputedId(set));
        expect(token).toBe('d20:m:112233:aabbcc');

        const decoded = diceSetFromLegacyLook(token);
        expect(decoded?.dice.d20.body.bodyColor).toBe('#112233');
        expect(decoded?.dice.d20.body.markingColor).toBe('#aabbcc');
    });

    it('emits nothing for an untouched set', () => {
        expect(serializeLegacyDiceLook(createDefaultDiceSet())).toBe('');
    });

    it('skips junk segments instead of failing the whole token', () => {
        const look = parseLegacyDiceLook('d6:r:ff0000:ffffff,nonsense,d99:x:1:2');
        expect(Object.keys(look ?? {})).toEqual(['d6']);
        expect(parseLegacyDiceLook('')).toBeNull();
        expect(parseLegacyDiceLook(null)).toBeNull();
    });

    it('overlays colours without disturbing markings', () => {
        const set = createDefaultDiceSet();
        const overlaid = applyLegacyDiceLook(set, parseLegacyDiceLook('d6:o:101010:ffffff'));
        expect(overlaid.dice.d6.body.bodyColor).toBe('#101010');
        expect(overlaid.dice.d6.faces).toEqual(set.dice.d6.faces);
        expect(overlaid.id).not.toBe(set.id);
    });
});

describe('dice set runtime', () => {
    beforeEach(() => {
        resetDiceSetRuntimeForTests();
        setActiveDiceSet(createDefaultDiceSet(), { persist: false, url: false });
    });

    it('offers every catalog type, not just the ones in the set', () => {
        const keys = listDieKeys();
        expect(keys).toEqual(expect.arrayContaining(['d6', 'dF', 'd2', 'd3', 'd5', 'd100']));
    });

    it('resolves a derived type to the hull it rides on', () => {
        expect(getDieShape('dF')).toBe('d6');
        expect(getDieShape('d100')).toBe('d10');
        expect(getDieShape('d20')).toBe('d20');
    });

    it('maps a settled natural face onto the value the die shows', () => {
        // A dF settles on a natural 6; the player is owed a +1, not a 6.
        expect(resolveDieFaceValue('dF', 6)).toBe(1);
        expect(resolveDieFaceValue('dF', 1)).toBe(-1);
        expect(resolveDieFaceValue('d2', 5)).toBe(1);
        expect(resolveDieFaceValue('d100', 3)).toBe(30);
        expect(resolveDieFaceValue('d20', 17)).toBe(17);
    });

    it('leaves an unsettled read alone', () => {
        expect(resolveDieFaceValue('dF', 0)).toBe(0);
    });

    it('re-hashes and notifies on a patch', () => {
        const before = getDieEntry('d6');
        const seen: string[][] = [];
        const unsubscribe = subscribeDiceSet((_set, changed) => seen.push(changed));

        const updated = updateDieEntry(
            'd6',
            { faces: { style: 'engraved' }, body: { bodyColor: '#010203' } },
            { persist: false, url: false }
        );

        expect(updated.faces.style).toBe('engraved');
        expect(updated.body.bodyColor).toBe('#010203');
        expect(updated.faces.glyphs).toBe(before.faces.glyphs);
        expect(seen).toEqual([['d6']]);
        unsubscribe();
    });

    it('normalises a patch rather than trusting it', () => {
        const updated = updateDieEntry(
            'd6',
            // @ts-expect-error deliberately invalid input from a URL or a peer
            { body: { preset: 'unobtanium' }, faces: { depth: 42 } },
            { persist: false, url: false }
        );
        expect(updated.body.preset).toBe('resin');
        expect(updated.faces.depth).toBe(1);
    });
});
