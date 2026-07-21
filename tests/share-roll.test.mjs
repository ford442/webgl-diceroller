/**
 * Unit tests for shareable roll URL helpers.
 * Run: node tests/share-roll.test.mjs
 */
import assert from 'node:assert/strict';
import {
    REPLAY_VERSION,
    serializeDiceCounts,
    parseDiceParam,
    parseShareableRollParams,
    buildShareableRollUrl,
    serializeDiceAppearance
} from '../src/roll/ShareableRoll.js';
import { createDefaultAppearanceConfig } from '../src/dice/DiceAppearanceConfig.js';
import { computeSeededThrowParams, createSeededRng } from '../src/wasm/seededThrowParams.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

console.log('ShareableRoll tests\n');

test('serializes non-zero dice counts', () => {
    assert.equal(serializeDiceCounts({ d4: 0, d6: 2, d20: 1 }), 'd6:2,d20:1');
});

test('parses dice param', () => {
    const counts = parseDiceParam('d20:1,d6:2');
    assert.equal(counts.d20, 1);
    assert.equal(counts.d6, 2);
    assert.equal(counts.d4, 0);
});

test('parseShareableRollParams requires version tag', () => {
    const params = new URLSearchParams('seed=99&dice=d20:1');
    const result = parseShareableRollParams(params);
    assert.equal(result?.error, 'unsupported_version');
});

test('parseShareableRollParams accepts v=1', () => {
    const params = new URLSearchParams(`seed=12345&dice=d20:1&v=${REPLAY_VERSION}`);
    const result = parseShareableRollParams(params);
    assert.equal(result.seed, 12345);
    assert.equal(result.diceCounts.d20, 1);
});

test('buildShareableRollUrl includes seed, dice, and version', () => {
    const url = buildShareableRollUrl(42, { d20: 1 }, 'http://example.test/roller');
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('seed'), '42');
    assert.equal(parsed.searchParams.get('dice'), 'd20:1');
    assert.equal(parsed.searchParams.get('v'), String(REPLAY_VERSION));
});

test('buildShareableRollUrl round-trips notation expression + system', () => {
    const url = buildShareableRollUrl(
        99,
        {},
        'http://example.test/roller',
        null,
        { expression: '2d20kh1+3 vs 1d20', system: 'dnd5e' }
    );
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('expr'), '2d20kh1+3 vs 1d20');
    assert.equal(parsed.searchParams.get('sys'), 'dnd5e');
    const replay = parseShareableRollParams(parsed.searchParams);
    assert.equal(replay.expression, '2d20kh1+3 vs 1d20');
    assert.equal(replay.system, 'dnd5e');
    assert.equal(replay.seed, 99);
});

test('buildShareableRollUrl includes dice appearance when customized', () => {
    const appearance = createDefaultAppearanceConfig();
    appearance.d20 = { preset: 'metal', bodyColor: '#112233', pipColor: '#aabbcc' };
    const url = buildShareableRollUrl(7, { d20: 1 }, 'http://example.test/roller', appearance);
    const parsed = new URL(url);
    assert.ok(parsed.searchParams.get('dice-look')?.includes('d20:m:112233:aabbcc'));
});

test('serializeDiceAppearance omits default-only types', () => {
    const appearance = createDefaultAppearanceConfig();
    assert.equal(serializeDiceAppearance(appearance), '');
});

test('seeded throw params are identical for the same seed', () => {
    const dice = [{ id: 0, index: 0 }, { id: 1, index: 1 }];
    const a = computeSeededThrowParams(createSeededRng(42424242), dice, 1.0);
    const b = computeSeededThrowParams(createSeededRng(42424242), dice, 1.0);
    assert.deepEqual(a, b);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
