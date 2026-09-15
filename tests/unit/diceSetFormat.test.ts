import { describe, it, expect, beforeEach } from 'vitest';
import {
    DICE_SET_VERSION,
    DIE_SHAPE_FACE_COUNT,
    canonicalizeDiceSet,
    computeDiceSetId,
    createDefaultDiceSet,
    createDefaultEntry,
    isValidDieKey,
    migrateLegacyAppearanceConfig,
    normalizeDiceSet,
    normalizeHexColor,
    resolveFaceValue,
    resolveFaceValues,
    toLegacyAppearanceConfig,
    withComputedId,
    type DiceSet,
} from '../../src/dice/DiceSetFormat.js';
import {
    DICE_SET_PARAM,
    DICE_SET_STORAGE_KEY,
    LEGACY_APPEARANCE_STORAGE_KEY,
    buildDiceSetPresencePayload,
    buildDiceSetShareUrl,
    decodeDiceSet,
    encodeDiceSet,
    loadStoredDiceSet,
    parseDiceSetFromParams,
    parseDiceSetPresencePayload,
    persistDiceSet,
    resolveDiceSet,
} from '../../src/dice/ShareableDiceSet.js';

describe('DiceSetFormat', () => {
    it('creates a default set covering every shipped die type', () => {
        const set = createDefaultDiceSet();
        expect(set.version).toBe(DICE_SET_VERSION);
        expect(Object.keys(set.dice).sort()).toEqual(['d10', 'd12', 'd20', 'd4', 'd6', 'd8']);
        expect(set.id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('hashes by content, not by identity or key order', () => {
        const a = createDefaultDiceSet('Table');
        const b = createDefaultDiceSet('Table');
        expect(a.id).toBe(b.id);

        const reordered = withComputedId({
            ...a,
            dice: Object.fromEntries(Object.entries(a.dice).reverse()),
        });
        expect(reordered.id).toBe(a.id);
    });

    it('changes the hash when any field changes', () => {
        const base = createDefaultDiceSet();
        const recoloured = withComputedId({
            ...base,
            dice: {
                ...base.dice,
                d20: {
                    ...base.dice.d20,
                    body: { ...base.dice.d20.body, bodyColor: '#123456' },
                },
            },
        });
        expect(recoloured.id).not.toBe(base.id);

        const renamed = withComputedId({ ...base, name: 'Other' });
        expect(renamed.id).not.toBe(base.id);
    });

    it('excludes the id from its own hash input', () => {
        const set = createDefaultDiceSet();
        expect(canonicalizeDiceSet(set)).not.toContain(set.id);
        expect(computeDiceSetId({ ...set, id: 'tampered' })).toBe(set.id);
    });

    it('normalizes hex colours in every accepted spelling', () => {
        expect(normalizeHexColor('#ABC', '#000000')).toBe('#aabbcc');
        expect(normalizeHexColor('aabbcc', '#000000')).toBe('#aabbcc');
        expect(normalizeHexColor('not-a-colour', '#ff0000')).toBe('#ff0000');
        expect(normalizeHexColor(undefined, '#ff0000')).toBe('#ff0000');
    });

    it('coerces junk input into a valid set instead of throwing', () => {
        for (const junk of [null, undefined, 42, 'nope', [], { dice: 'nope' }]) {
            const set = normalizeDiceSet(junk);
            expect(set.version).toBe(DICE_SET_VERSION);
            expect(Object.keys(set.dice).length).toBeGreaterThan(0);
            expect(set.id).toBe(computeDiceSetId(set));
        }
    });

    it('drops unusable die keys and clamps out-of-range numbers', () => {
        const set = normalizeDiceSet({
            name: 'x'.repeat(200),
            dice: {
                'bad key': createDefaultEntry('d6'),
                d6: {
                    shape: 'not-a-shape',
                    body: { preset: 'nope', bodyColor: 'zzz', translucency: 9 },
                    faces: { style: 'nope', depth: -3 },
                },
            },
        });
        expect(Object.keys(set.dice)).toEqual(['d6']);
        expect(set.name.length).toBe(64);
        expect(set.dice.d6.shape).toBe('d6');
        expect(set.dice.d6.body.preset).toBe('resin');
        expect(set.dice.d6.body.translucency).toBe(1);
        expect(set.dice.d6.faces.depth).toBe(0);
    });

    it('validates die keys', () => {
        expect(isValidDieKey('d6')).toBe(true);
        expect(isValidDieKey('dF')).toBe(true);
        expect(isValidDieKey('6d')).toBe(false);
        expect(isValidDieKey('has space')).toBe(false);
        expect(isValidDieKey('')).toBe(false);
    });
});

describe('face value resolution', () => {
    it('reads natural values when there is no remapping', () => {
        const d20 = createDefaultEntry('d20');
        expect(resolveFaceValues(d20)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('builds dF, d2 and d3 from the d6 mesh with no new asset', () => {
        for (const key of ['dF', 'd2', 'd3']) {
            const entry = createDefaultEntry(key);
            expect(entry.shape).toBe('d6');
            expect(resolveFaceValues(entry)).toHaveLength(DIE_SHAPE_FACE_COUNT.d6);
        }
        expect(resolveFaceValues(createDefaultEntry('dF'))).toEqual([-1, 0, 1, -1, 0, 1]);
        expect(resolveFaceValues(createDefaultEntry('d2'))).toEqual([1, 2, 1, 2, 1, 2]);
        expect(resolveFaceValues(createDefaultEntry('d3'))).toEqual([1, 2, 3, 1, 2, 3]);
    });

    it('supports start/step numbering', () => {
        const entry = createDefaultEntry('d10');
        entry.numbering = { start: 0, step: 10, sequence: null };
        expect(resolveFaceValues(entry)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    });

    it('ignores a sequence whose length does not match the face count', () => {
        const set = normalizeDiceSet({
            dice: { d6: { shape: 'd6', numbering: { sequence: [1, 2, 3] } } },
        });
        expect(set.dice.d6.numbering.sequence).toBeNull();
        expect(resolveFaceValues(set.dice.d6)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('passes through face values outside the natural range', () => {
        const entry = createDefaultEntry('d6');
        expect(resolveFaceValue(entry, 0)).toBe(0);
        expect(resolveFaceValue(entry, 99)).toBe(99);
    });
});

describe('v0 migration', () => {
    const legacy = {
        d6: { preset: 'metal', bodyColor: '#010203', pipColor: '#040506' },
        d20: { preset: 'bogus', bodyColor: 'bad', pipColor: '#abc' },
    };

    it('lifts a legacy appearance config into a set', () => {
        const set = migrateLegacyAppearanceConfig(legacy);
        expect(set.dice.d6.body.preset).toBe('metal');
        expect(set.dice.d6.body.bodyColor).toBe('#010203');
        expect(set.dice.d6.body.markingColor).toBe('#040506');
        // Invalid legacy fields fall back to that die's curated default.
        expect(set.dice.d20.body.preset).toBe('obsidian');
        expect(set.dice.d20.body.markingColor).toBe('#aabbcc');
        expect(set.id).toBe(computeDiceSetId(set));
    });

    it('round-trips back to the legacy shape', () => {
        const set = migrateLegacyAppearanceConfig(legacy);
        const back = toLegacyAppearanceConfig(set);
        expect(back.d6).toEqual({
            preset: 'metal',
            bodyColor: '#010203',
            pipColor: '#040506',
        });
        expect(migrateLegacyAppearanceConfig(back).id).toBe(set.id);
    });

    it('returns defaults for a missing legacy config', () => {
        expect(migrateLegacyAppearanceConfig(null).id).toBe(createDefaultDiceSet().id);
    });
});

describe('ShareableDiceSet', () => {
    let custom: DiceSet;

    beforeEach(() => {
        localStorage.clear();
        const base = createDefaultDiceSet('Midnight');
        custom = withComputedId({
            ...base,
            dice: {
                ...base.dice,
                d20: {
                    ...base.dice.d20,
                    body: { ...base.dice.d20.body, bodyColor: '#101820', translucency: 0.4 },
                    faces: { ...base.dice.d20.faces, style: 'engraved', underlineSixNine: true },
                },
            },
        });
    });

    it('round-trips through the URL token with a stable id', () => {
        const encoded = encodeDiceSet(custom);
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
        const decoded = decodeDiceSet(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded).toEqual(custom);
        expect(decoded!.id).toBe(custom.id);
    });

    it('builds and parses a share URL', () => {
        const url = buildDiceSetShareUrl(custom, 'https://example.test/roll?seed=7');
        const parsed = parseDiceSetFromParams(new URL(url).searchParams);
        expect(parsed!.id).toBe(custom.id);
        expect(new URL(url).searchParams.get('seed')).toBe('7');
        expect(buildDiceSetShareUrl(null, url)).not.toContain(DICE_SET_PARAM);
    });

    it('rejects malformed, oversized and wrong-version tokens', () => {
        expect(decodeDiceSet(null)).toBeNull();
        expect(decodeDiceSet('')).toBeNull();
        expect(decodeDiceSet('!!!not base64!!!')).toBeNull();
        expect(decodeDiceSet(encodeURIComponent('x'.repeat(9000)))).toBeNull();
        const wrongVersion = Buffer.from(JSON.stringify({ version: 99, dice: {} })).toString(
            'base64url'
        );
        expect(decodeDiceSet(wrongVersion)).toBeNull();
        const notAnObject = Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url');
        expect(decodeDiceSet(notAnObject)).toBeNull();
    });

    it('round-trips through localStorage', () => {
        persistDiceSet(custom);
        expect(localStorage.getItem(DICE_SET_STORAGE_KEY)).toBeTruthy();
        expect(loadStoredDiceSet()!.id).toBe(custom.id);
    });

    it('migrates a v0 localStorage payload when no v1 set is stored', () => {
        localStorage.setItem(
            LEGACY_APPEARANCE_STORAGE_KEY,
            JSON.stringify({
                version: 1,
                types: { d6: { preset: 'glow', bodyColor: '#ff00ff', pipColor: '#00ff00' } },
            })
        );
        const loaded = loadStoredDiceSet();
        expect(loaded!.dice.d6.body.preset).toBe('glow');
        expect(loaded!.dice.d6.body.bodyColor).toBe('#ff00ff');
    });

    it('returns null when nothing is stored, and defaults when resolving', () => {
        expect(loadStoredDiceSet()).toBeNull();
        expect(resolveDiceSet(new URLSearchParams()).id).toBe(createDefaultDiceSet().id);
    });

    it('prefers the URL token over stored state', () => {
        persistDiceSet(createDefaultDiceSet('Stored'));
        const params = new URLSearchParams({ [DICE_SET_PARAM]: encodeDiceSet(custom) });
        expect(resolveDiceSet(params).id).toBe(custom.id);
    });

    it('carries a set through multiplayer presence', () => {
        const payload = buildDiceSetPresencePayload(custom);
        expect(payload.diceSetId).toBe(custom.id);
        expect(parseDiceSetPresencePayload(payload)!.id).toBe(custom.id);
        expect(parseDiceSetPresencePayload(null)).toBeNull();
        // A payload whose advertised id disagrees with its content is dropped.
        expect(
            parseDiceSetPresencePayload({ ...payload, diceSetId: 'deadbeefdeadbeef' })
        ).toBeNull();
    });
});
