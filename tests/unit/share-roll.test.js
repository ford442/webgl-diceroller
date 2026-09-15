/**
 * Unit tests for shareable roll URL helpers.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultAppearanceConfig } from '../../src/dice/DiceAppearanceConfig.js';
import {
    REPLAY_VERSION,
    buildShareableRollUrl,
    parseDiceParam,
    parseShareableRollParams,
    serializeDiceAppearance,
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
        const params = new URLSearchParams(`seed=12345&dice=d20:1&v=${REPLAY_VERSION}`);
        const result = parseShareableRollParams(params);
        if (!result || 'error' in result) throw new Error('expected a successful parse');
        expect(result.seed).toBe(12345);
        expect(result.diceCounts.d20).toBe(1);
    });

    it('includes seed, dice, and version in the built URL', () => {
        const url = buildShareableRollUrl(42, { d20: 1 }, 'http://example.test/roller');
        const parsed = new URL(url);
        expect(parsed.searchParams.get('seed')).toBe('42');
        expect(parsed.searchParams.get('dice')).toBe('d20:1');
        expect(parsed.searchParams.get('v')).toBe(String(REPLAY_VERSION));
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

    it('includes dice appearance when customized', () => {
        const appearance = createDefaultAppearanceConfig();
        appearance.d20 = { preset: 'metal', bodyColor: '#112233', pipColor: '#aabbcc' };
        const url = buildShareableRollUrl(7, { d20: 1 }, 'http://example.test/roller', appearance);
        const parsed = new URL(url);
        expect(parsed.searchParams.get('dice-look')).toContain('d20:m:112233:aabbcc');
    });

    it('omits default-only appearance types', () => {
        const appearance = createDefaultAppearanceConfig();
        expect(serializeDiceAppearance(appearance)).toBe('');
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
