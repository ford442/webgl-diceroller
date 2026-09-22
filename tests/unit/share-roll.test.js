/**
 * Unit tests for shareable roll URL helpers.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultDiceSet, withComputedId } from '../../src/dice/DiceSetFormat.js';
import { serializeLegacyDiceLook } from '../../src/dice/LegacyDiceLook.js';
import {
    REPLAY_VERSION,
    ROLL_SOURCE_PARAM,
    buildShareableRollUrl,
    parseDiceParam,
    parseRollSource,
    parseShareableRollDiceSet,
    parseShareableRollParams,
    serializeDiceCounts,
} from '../../src/roll/ShareableRoll.js';
import { computeSeededThrowParams, createSeededRng } from '../../src/wasm/seededThrowParams.js';

describe('ShareableRoll', () => {
    it('serializes non-zero dice counts', () => {
        expect(serializeDiceCounts({ d4: 0, d6: 2, d20: 1 })).toBe('d6:2,d20:1');
    });

    it('parses a dice param', () => {
        const counts = parseDiceParam('d20:1,d6:2');
        expect(counts.d20).toBe(1);
        expect(counts.d6).toBe(2);
        expect(counts.d4).toBe(0);
    });

    it('requires a version tag', () => {
        const params = new URLSearchParams('seed=99&dice=d20:1');
        const result = parseShareableRollParams(params);
        if (!result || !('error' in result))
            throw new Error('expected an unsupported_version error');
        expect(result.error).toBe('unsupported_version');
    });

    it('accepts v=1', () => {
        const params = new URLSearchParams('seed=12345&dice=d20:1&v=1');
        const result = parseShareableRollParams(params);
        if (!result || 'error' in result) throw new Error('expected a successful parse');
        expect(result.seed).toBe(12345);
        expect(result.diceCounts.d20).toBe(1);
        expect(result.source).toBe('throw');
    });

    it('accepts the current version', () => {
        const params = new URLSearchParams(`seed=12345&dice=d20:1&v=${REPLAY_VERSION}`);
        const result = parseShareableRollParams(params);
        if (!result || 'error' in result) throw new Error('expected a successful parse');
        expect(result.seed).toBe(12345);
        expect(result.source).toBe('throw');
    });

    it('rejects a version this build cannot read', () => {
        const params = new URLSearchParams(`seed=1&v=${REPLAY_VERSION + 1}`);
        const result = parseShareableRollParams(params);
        if (!result || !('error' in result))
            throw new Error('expected an unsupported_version error');
        expect(result.error).toBe('unsupported_version');
    });

    it('includes seed, dice, and version in the built URL', () => {
        const url = buildShareableRollUrl(42, { d20: 1 }, 'http://example.test/roller');
        const parsed = new URL(url);
        expect(parsed.searchParams.get('seed')).toBe('42');
        expect(parsed.searchParams.get('dice')).toBe('d20:1');
        // A throw still writes v=1: `src` is the only thing v2 added, so links
        // that don't need it keep replaying on clients that predate it.
        expect(parsed.searchParams.get('v')).toBe('1');
        expect(parsed.searchParams.get(ROLL_SOURCE_PARAM)).toBeNull();
    });

    it('marks a tower drop on the URL and reads it back', () => {
        const url = buildShareableRollUrl(1234, { d6: 3 }, 'http://example.test/roller', null, {
            source: 'tower',
        });
        const parsed = new URL(url);
        expect(parsed.searchParams.get(ROLL_SOURCE_PARAM)).toBe('tower');
        // A tower link must NOT claim v=1 — a v1 client would replay the seed
        // as a throw and land different faces from the ones that were shared.
        expect(parsed.searchParams.get('v')).toBe('2');

        const replay = parseShareableRollParams(parsed.searchParams);
        if (!replay || 'error' in replay) throw new Error('expected a successful parse');
        expect(replay.source).toBe('tower');
        expect(replay.seed).toBe(1234);
        expect(replay.diceCounts.d6).toBe(3);
    });

    it('ignores src on a v1 link, which predates the param', () => {
        const params = new URLSearchParams('seed=7&v=1&src=tower');
        const result = parseShareableRollParams(params);
        if (!result || 'error' in result) throw new Error('expected a successful parse');
        expect(result.source).toBe('throw');
    });

    it('falls back to a throw for a source it does not know', () => {
        expect(parseRollSource('catapult')).toBeNull();
        const params = new URLSearchParams(`seed=7&v=${REPLAY_VERSION}&src=catapult`);
        const result = parseShareableRollParams(params);
        if (!result || 'error' in result) throw new Error('expected a successful parse');
        expect(result.source).toBe('throw');
    });

    it('round-trips notation expression + system', () => {
        const url = buildShareableRollUrl(99, {}, 'http://example.test/roller', null, {
            expression: '2d20kh1+3 vs 1d20',
            system: 'dnd5e',
        });
        const parsed = new URL(url);
        expect(parsed.searchParams.get('expr')).toBe('2d20kh1+3 vs 1d20');
        expect(parsed.searchParams.get('sys')).toBe('dnd5e');
        const replay = parseShareableRollParams(parsed.searchParams);
        if (!replay || 'error' in replay) throw new Error('expected a successful parse');
        expect(replay.expression).toBe('2d20kh1+3 vs 1d20');
        expect(replay.system).toBe('dnd5e');
        expect(replay.seed).toBe(99);
    });

    it('carries a derived die through the counts param', () => {
        // A 4dF roll has to survive a share link; dF is not a hull, so a
        // hand-written list of shapes would drop it silently.
        expect(serializeDiceCounts({ dF: 4, d20: 1 })).toBe('d20:1,dF:4');

        const counts = parseDiceParam('d20:1,dF:4');
        expect(counts.dF).toBe(4);
        expect(counts.d20).toBe(1);
    });

    it('rejects a counts param naming nothing it knows', () => {
        expect(parseDiceParam('d7:2,nonsense:1')).toBeNull();
    });

    it('round-trips the whole dice set, not just two colours', () => {
        const set = createDefaultDiceSet();
        set.dice.d20 = {
            ...set.dice.d20,
            body: { ...set.dice.d20.body, preset: 'metal', bodyColor: '#112233' },
            faces: { ...set.dice.d20.faces, style: 'engraved', glyphs: 'numerals' },
        };
        const customized = withComputedId(set);

        const url = buildShareableRollUrl(7, { d20: 1 }, 'http://example.test/roller', customized);
        const decoded = parseShareableRollDiceSet(new URL(url).searchParams);

        expect(decoded).not.toBeNull();
        expect(decoded.id).toBe(customized.id);
        expect(decoded.dice.d20.body.bodyColor).toBe('#112233');
        expect(decoded.dice.d20.faces.style).toBe('engraved');
    });

    it('stops writing the v0 short code but still reads one', () => {
        const set = createDefaultDiceSet();
        set.dice.d20 = {
            ...set.dice.d20,
            body: { ...set.dice.d20.body, preset: 'metal', bodyColor: '#112233' },
        };
        const legacyToken = serializeLegacyDiceLook(withComputedId(set));
        expect(legacyToken).toContain('d20:m:112233');

        const url = buildShareableRollUrl(7, { d20: 1 }, 'http://example.test/roller', set);
        expect(new URL(url).searchParams.get('dice-look')).toBeNull();

        const legacyUrl = new URL(`http://example.test/roller?dice-look=${legacyToken}`);
        const decoded = parseShareableRollDiceSet(legacyUrl.searchParams);
        expect(decoded.dice.d20.body.bodyColor).toBe('#112233');
        expect(decoded.dice.d20.body.preset).toBe('metal');
    });

    it('drops a v0 short code when a v1 set is also present', () => {
        const set = createDefaultDiceSet();
        const url = new URL(
            buildShareableRollUrl(
                7,
                { d20: 1 },
                'http://example.test/roller?dice-look=d20:m:112233:aabbcc',
                set
            )
        );
        expect(url.searchParams.get('dice-look')).toBeNull();
        expect(parseShareableRollDiceSet(url.searchParams).id).toBe(set.id);
    });
});

describe('seeded throw params', () => {
    it('are identical for the same seed', () => {
        const dice = [
            { id: 0, index: 0 },
            { id: 1, index: 1 },
        ];
        const a = computeSeededThrowParams(createSeededRng(42424242), dice, 1.0);
        const b = computeSeededThrowParams(createSeededRng(42424242), dice, 1.0);
        expect(a).toEqual(b);
    });
});
