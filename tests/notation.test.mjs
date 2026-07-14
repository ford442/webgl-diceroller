/**
 * Unit tests for dice notation parser and evaluator.
 * Run: node tests/notation.test.mjs
 */

import assert from 'node:assert/strict';
import {
    parseNotation,
    buildSpawnSpecs,
    evaluateRoll,
    mapPercentileComponent,
    composePercentile,
    formatGroupLabel,
    getExplodingRespawnSpecs,
    NotationError
} from '../src/roll/Notation.js';

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

console.log('Notation parser tests\n');

test('parses 3d6+2', () => {
    const p = parseNotation('3d6+2');
    assert.equal(p.groups.length, 1);
    assert.equal(p.groups[0].count, 3);
    assert.equal(p.groups[0].sides, 6);
    assert.equal(p.modifier, 2);
});

test('parses 2d20kh1 advantage', () => {
    const p = parseNotation('2d20kh1');
    assert.equal(p.groups[0].keep, 'h');
    assert.equal(p.groups[0].keepCount, 1);
});

test('parses 2d20kl1 disadvantage', () => {
    const p = parseNotation('2d20kl1');
    assert.equal(p.groups[0].keep, 'l');
});

test('parses 4d6dl1 drop lowest', () => {
    const p = parseNotation('4d6dl1');
    assert.equal(p.groups[0].drop, 'l');
    assert.equal(p.groups[0].dropCount, 1);
});

test('parses exploding 2d6!', () => {
    const p = parseNotation('2d6!');
    assert.equal(p.groups[0].explode, true);
});

test('parses 1d100 percentile', () => {
    const p = parseNotation('1d100');
    assert.equal(p.groups[0].percentile, true);
    assert.equal(p.groups[0].sides, 100);
});

test('parses 1d% alias', () => {
    const p = parseNotation('1d%');
    assert.equal(p.groups[0].percentile, true);
});

test('parses compound 1d20+3d6+2', () => {
    const p = parseNotation('1d20+3d6+2');
    assert.equal(p.groups.length, 2);
    assert.equal(p.groups[0].sides, 20);
    assert.equal(p.groups[1].count, 3);
    assert.equal(p.modifier, 2);
});

test('rejects empty notation', () => {
    assert.throws(() => parseNotation(''), NotationError);
});

test('rejects unsupported die', () => {
    assert.throws(() => parseNotation('1d7'), NotationError);
});

test('buildSpawnSpecs for percentile yields two d10s', () => {
    const specs = buildSpawnSpecs(parseNotation('1d100'));
    assert.equal(specs.length, 2);
    assert.equal(specs[0].role, 'tens');
    assert.equal(specs[1].role, 'ones');
});

test('percentile composition 00+0 = 100', () => {
    assert.equal(composePercentile(0, 0), 100);
    assert.equal(composePercentile(30, 4), 34);
});

test('mapPercentileComponent tens mapping', () => {
    assert.equal(mapPercentileComponent(10, 'tens'), 0);
    assert.equal(mapPercentileComponent(3, 'tens'), 30);
});

test('evaluateRoll keep highest', () => {
    const parsed = parseNotation('2d20kh1');
    const result = evaluateRoll(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd20', value: 8 },
        { groupIndex: 0, dieIndex: 1, type: 'd20', value: 17 }
    ]);
    assert.equal(result.total, 17);
    assert.equal(result.dice[1].kept, true);
    assert.equal(result.dice[0].dropped, true);
});

test('evaluateRoll drop lowest', () => {
    const parsed = parseNotation('4d6dl1');
    const dice = [2, 5, 3, 6].map((value, i) => ({
        groupIndex: 0, dieIndex: i, type: 'd6', value
    }));
    const result = evaluateRoll(parsed, dice);
    assert.equal(result.total, 14); // 5+3+6
});

test('evaluateRoll modifier', () => {
    const parsed = parseNotation('1d6+5');
    const result = evaluateRoll(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 3 }
    ]);
    assert.equal(result.total, 8);
});

test('getExplodingRespawnSpecs on max roll', () => {
    const parsed = parseNotation('1d6!');
    const specs = getExplodingRespawnSpecs(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 6 }
    ]);
    assert.equal(specs.length, 1);
});

test('formatGroupLabel', () => {
    const p = parseNotation('2d20kh1');
    assert.equal(formatGroupLabel(p.groups[0]), '2d20kh1');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
