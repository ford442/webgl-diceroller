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
    getRerollRespawnSpecs,
    applyExpressionChip,
    defaultExpressionForSystem,
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
    assert.equal(p.groups[0].compound, false);
});

test('parses compounding 4d6!!', () => {
    const p = parseNotation('4d6!!');
    assert.equal(p.groups[0].explode, true);
    assert.equal(p.groups[0].compound, true);
    assert.equal(formatGroupLabel(p.groups[0]), '4d6!!');
});

test('parses reroll once 4d6r1', () => {
    const p = parseNotation('4d6r1');
    assert.equal(p.groups[0].rerollMax, 1);
    assert.equal(formatGroupLabel(p.groups[0]), '4d6r1');
});

test('parses keep + reroll + explode 4d6kh3r1!', () => {
    const p = parseNotation('4d6kh3r1!');
    assert.equal(p.groups[0].keep, 'h');
    assert.equal(p.groups[0].keepCount, 3);
    assert.equal(p.groups[0].rerollMax, 1);
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

test('parses opposed 1d20+5 vs 1d20+2', () => {
    const p = parseNotation('1d20+5 vs 1d20+2');
    assert.ok(p.opposed);
    assert.equal(p.groups[0].sides, 20);
    assert.equal(p.modifier, 5);
    assert.equal(p.opposed.groups[0].sides, 20);
    assert.equal(p.opposed.modifier, 2);
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
    assert.equal(result.flags.advantage, true);
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

test('evaluateRoll opposed margin', () => {
    const parsed = parseNotation('1d20+5 vs 1d20+2');
    const result = evaluateRoll(
        parsed,
        [{ groupIndex: 0, dieIndex: 0, type: 'd20', value: 10 }],
        { opposedDice: [{ groupIndex: 0, dieIndex: 0, type: 'd20', value: 8 }], seed: 99 }
    );
    assert.equal(result.total, 15);
    assert.equal(result.opposed.total, 10);
    assert.equal(result.opposed.margin, 5);
    assert.equal(result.seed, 99);
    assert.equal(result.flags.opposedWin, true);
});

test('evaluateRoll dnd5e crit / fumble flags', () => {
    const crit = evaluateRoll(parseNotation('1d20'), [
        { groupIndex: 0, dieIndex: 0, type: 'd20', value: 20 }
    ], { system: 'dnd5e' });
    assert.equal(crit.flags.crit, true);
    assert.equal(crit.flags.fumble, false);

    const fumble = evaluateRoll(parseNotation('1d20'), [
        { groupIndex: 0, dieIndex: 0, type: 'd20', value: 1 }
    ], { system: 'dnd5e' });
    assert.equal(fumble.flags.fumble, true);
});

test('evaluateRoll advantage crit uses kept die only', () => {
    const result = evaluateRoll(parseNotation('2d20kh1'), [
        { groupIndex: 0, dieIndex: 0, type: 'd20', value: 1 },
        { groupIndex: 0, dieIndex: 1, type: 'd20', value: 20 }
    ], { system: 'dnd5e' });
    assert.equal(result.flags.crit, true);
    assert.equal(result.flags.fumble, false);
    assert.equal(result.flags.advantage, true);
});

test('evaluateRoll pbta bands map to crit/fumble', () => {
    const strong = evaluateRoll(parseNotation('2d6'), [
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 5 },
        { groupIndex: 0, dieIndex: 1, type: 'd6', value: 6 }
    ], { system: 'pbta' });
    assert.equal(strong.total, 11);
    assert.equal(strong.flags.strongHit, true);
    assert.equal(strong.flags.crit, true);

    const miss = evaluateRoll(parseNotation('2d6'), [
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 1 },
        { groupIndex: 0, dieIndex: 1, type: 'd6', value: 2 }
    ], { system: 'pbta' });
    assert.equal(miss.flags.miss, true);
    assert.equal(miss.flags.fumble, true);
});

test('evaluateRoll reroll prefers replacement value', () => {
    const parsed = parseNotation('1d6r1');
    const result = evaluateRoll(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 1, replacedByReroll: true },
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 4, rerolled: true }
    ]);
    assert.equal(result.total, 4);
});

test('getExplodingRespawnSpecs on max roll', () => {
    const parsed = parseNotation('1d6!');
    const specs = getExplodingRespawnSpecs(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 6 }
    ]);
    assert.equal(specs.length, 1);
});

test('getRerollRespawnSpecs on low face', () => {
    const parsed = parseNotation('2d6r1');
    const specs = getRerollRespawnSpecs(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd6', value: 1 },
        { groupIndex: 0, dieIndex: 1, type: 'd6', value: 3 }
    ]);
    assert.equal(specs.length, 1);
    assert.equal(specs[0].dieIndex, 0);
    assert.equal(specs[0].isReroll, true);
});

test('formatGroupLabel', () => {
    const p = parseNotation('2d20kh1');
    assert.equal(formatGroupLabel(p.groups[0]), '2d20kh1');
});

test('applyExpressionChip advantage / explode / percentile / reroll1', () => {
    assert.equal(applyExpressionChip('1d20+3', 'advantage'), '2d20kh1+3');
    assert.equal(applyExpressionChip('1d20+3', 'disadvantage'), '2d20kl1+3');
    assert.equal(applyExpressionChip('3d6', 'explode'), '3d6!');
    assert.equal(applyExpressionChip('3d6!', 'compound'), '3d6!!');
    assert.equal(applyExpressionChip('4d6', 'reroll1'), '4d6r1');
    assert.equal(applyExpressionChip('', 'percentile'), '1d100');
});

test('defaultExpressionForSystem', () => {
    assert.equal(defaultExpressionForSystem('pbta'), '2d6');
    assert.equal(defaultExpressionForSystem('coc'), '1d100');
    assert.equal(defaultExpressionForSystem('savage'), '1d8!');
    assert.equal(defaultExpressionForSystem('dnd5e'), '1d20');
});

test('result rolls schema includes die/faces/value', () => {
    const result = evaluateRoll(parseNotation('1d20'), [
        { groupIndex: 0, dieIndex: 0, type: 'd20', value: 12 }
    ], { seed: 7 });
    assert.equal(result.rolls.length, 1);
    assert.equal(result.rolls[0].die, 'd20');
    assert.equal(result.rolls[0].faces, 20);
    assert.equal(result.rolls[0].value, 12);
    assert.equal(result.seed, 7);
    assert.ok(result.flags);
});

test('computeFlags coc percentile fumble', () => {
    const parsed = parseNotation('1d100');
    const dice = [
        { groupIndex: 0, dieIndex: 0, type: 'd10', value: 10, role: 'tens', kept: true },
        { groupIndex: 0, dieIndex: 1, type: 'd10', value: 8, role: 'ones', kept: true }
    ];
    // 00 + 8 = 8 — not a fumble; use 90+6 via display path through evaluateRoll
    const result = evaluateRoll(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd10', value: 10, role: 'tens' },
        { groupIndex: 0, dieIndex: 1, type: 'd10', value: 6, role: 'ones' }
    ], { system: 'coc' });
    // tens 10→0, ones 6→6 => 6, not fumble
    assert.equal(result.total, 6);
    assert.equal(result.flags.fumble, false);

    const fumble = evaluateRoll(parsed, [
        { groupIndex: 0, dieIndex: 0, type: 'd10', value: 9, role: 'tens' },
        { groupIndex: 0, dieIndex: 1, type: 'd10', value: 8, role: 'ones' }
    ], { system: 'coc' });
    assert.equal(fumble.total, 98);
    assert.equal(fumble.flags.fumble, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
