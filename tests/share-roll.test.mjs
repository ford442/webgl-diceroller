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
    buildShareableRollUrl
} from '../src/roll/ShareableRoll.js';
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

test('seeded throw params are identical for the same seed', () => {
    const dice = [{ id: 0, index: 0 }, { id: 1, index: 1 }];
    const a = computeSeededThrowParams(createSeededRng(42424242), dice, 1.0);
    const b = computeSeededThrowParams(createSeededRng(42424242), dice, 1.0);
    assert.deepEqual(a, b);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
