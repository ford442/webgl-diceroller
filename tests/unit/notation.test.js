/**
 * Unit tests for the dice notation parser and evaluator.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
    SUPPORTED_SIDES as PARSER_SUPPORTED_SIDES,
    NotationError,
    applyExpressionChip,
    buildSpawnSpecs,
    composePercentile,
    defaultExpressionForSystem,
    evaluateRoll,
    formatGroupLabel,
    getExplodingRespawnSpecs,
    getRerollRespawnSpecs,
    mapPercentileComponent,
    parseNotation,
} from '../../src/roll/Notation.js';

describe('parseNotation', () => {
    it('parses 3d6+2', () => {
        const p = parseNotation('3d6+2');
        expect(p.groups.length).toBe(1);
        expect(p.groups[0].count).toBe(3);
        expect(p.groups[0].sides).toBe(6);
        expect(p.modifier).toBe(2);
    });

    it('parses 2d20kh1 advantage', () => {
        const p = parseNotation('2d20kh1');
        expect(p.groups[0].keep).toBe('h');
        expect(p.groups[0].keepCount).toBe(1);
    });

    it('parses 2d20kl1 disadvantage', () => {
        const p = parseNotation('2d20kl1');
        expect(p.groups[0].keep).toBe('l');
    });

    it('parses 4d6dl1 drop lowest', () => {
        const p = parseNotation('4d6dl1');
        expect(p.groups[0].drop).toBe('l');
        expect(p.groups[0].dropCount).toBe(1);
    });

    it('parses exploding 2d6!', () => {
        const p = parseNotation('2d6!');
        expect(p.groups[0].explode).toBe(true);
        expect(p.groups[0].compound).toBe(false);
    });

    it('parses compounding 4d6!!', () => {
        const p = parseNotation('4d6!!');
        expect(p.groups[0].explode).toBe(true);
        expect(p.groups[0].compound).toBe(true);
        expect(formatGroupLabel(p.groups[0])).toBe('4d6!!');
    });

    it('parses reroll once 4d6r1', () => {
        const p = parseNotation('4d6r1');
        expect(p.groups[0].rerollMax).toBe(1);
        expect(formatGroupLabel(p.groups[0])).toBe('4d6r1');
    });

    it('parses keep + reroll + explode 4d6kh3r1!', () => {
        const p = parseNotation('4d6kh3r1!');
        expect(p.groups[0].keep).toBe('h');
        expect(p.groups[0].keepCount).toBe(3);
        expect(p.groups[0].rerollMax).toBe(1);
        expect(p.groups[0].explode).toBe(true);
    });

    it('parses 1d100 percentile', () => {
        const p = parseNotation('1d100');
        expect(p.groups[0].percentile).toBe(true);
        expect(p.groups[0].sides).toBe(100);
    });

    it('parses 1d% alias', () => {
        const p = parseNotation('1d%');
        expect(p.groups[0].percentile).toBe(true);
    });

    it('parses opposed 1d20+5 vs 1d20+2', () => {
        const p = parseNotation('1d20+5 vs 1d20+2');
        expect(p.opposed).toBeTruthy();
        expect(p.groups[0].sides).toBe(20);
        expect(p.modifier).toBe(5);
        expect(p.opposed.groups[0].sides).toBe(20);
        expect(p.opposed.modifier).toBe(2);
    });

    it('parses compound 1d20+3d6+2', () => {
        const p = parseNotation('1d20+3d6+2');
        expect(p.groups.length).toBe(2);
        expect(p.groups[0].sides).toBe(20);
        expect(p.groups[1].count).toBe(3);
        expect(p.modifier).toBe(2);
    });

    it('rejects empty notation', () => {
        expect(() => parseNotation('')).toThrow(NotationError);
    });

    it('rejects whitespace-only notation', () => {
        expect(() => parseNotation('   ')).toThrow(NotationError);
    });

    it('rejects unsupported die', () => {
        expect(() => parseNotation('1d7')).toThrow(NotationError);
    });

    it('rejects an opposed roll missing one side', () => {
        expect(() => parseNotation('1d20 vs')).toThrow(NotationError);
        expect(() => parseNotation('vs 1d20')).toThrow(NotationError);
    });

    it('rejects garbage with no dice groups', () => {
        expect(() => parseNotation('hello world')).toThrow(NotationError);
    });
});

describe('spawn specs and percentile helpers', () => {
    it('buildSpawnSpecs for percentile yields two d10s', () => {
        const specs = buildSpawnSpecs(parseNotation('1d100'));
        expect(specs.length).toBe(2);
        expect(specs[0].role).toBe('tens');
        expect(specs[1].role).toBe('ones');
    });

    it('percentile composition 00+0 = 100', () => {
        expect(composePercentile(0, 0)).toBe(100);
        expect(composePercentile(30, 4)).toBe(34);
    });

    it('mapPercentileComponent tens mapping', () => {
        expect(mapPercentileComponent(10, 'tens')).toBe(0);
        expect(mapPercentileComponent(3, 'tens')).toBe(30);
    });
});

describe('evaluateRoll', () => {
    it('keeps the highest die', () => {
        const parsed = parseNotation('2d20kh1');
        const result = evaluateRoll(parsed, [
            { groupIndex: 0, dieIndex: 0, type: 'd20', value: 8 },
            { groupIndex: 0, dieIndex: 1, type: 'd20', value: 17 },
        ]);
        expect(result.total).toBe(17);
        expect(result.dice[1].kept).toBe(true);
        expect(result.dice[0].dropped).toBe(true);
        expect(result.flags.advantage).toBe(true);
    });

    it('drops the lowest die', () => {
        const parsed = parseNotation('4d6dl1');
        const dice = [2, 5, 3, 6].map((value, i) => ({
            groupIndex: 0,
            dieIndex: i,
            type: 'd6',
            value,
        }));
        const result = evaluateRoll(parsed, dice);
        expect(result.total).toBe(14); // 5+3+6
    });

    it('applies the net modifier', () => {
        const parsed = parseNotation('1d6+5');
        const result = evaluateRoll(parsed, [{ groupIndex: 0, dieIndex: 0, type: 'd6', value: 3 }]);
        expect(result.total).toBe(8);
    });

    it('computes opposed margin', () => {
        const parsed = parseNotation('1d20+5 vs 1d20+2');
        const result = evaluateRoll(
            parsed,
            [{ groupIndex: 0, dieIndex: 0, type: 'd20', value: 10 }],
            {
                opposedDice: [{ groupIndex: 0, dieIndex: 0, type: 'd20', value: 8 }],
                seed: 99,
            }
        );
        expect(result.total).toBe(15);
        expect(result.opposed.total).toBe(10);
        expect(result.opposed.margin).toBe(5);
        expect(result.seed).toBe(99);
        expect(result.flags.opposedWin).toBe(true);
    });

    it('flags dnd5e crit / fumble', () => {
        const crit = evaluateRoll(
            parseNotation('1d20'),
            [{ groupIndex: 0, dieIndex: 0, type: 'd20', value: 20 }],
            { system: 'dnd5e' }
        );
        expect(crit.flags.crit).toBe(true);
        expect(crit.flags.fumble).toBe(false);

        const fumble = evaluateRoll(
            parseNotation('1d20'),
            [{ groupIndex: 0, dieIndex: 0, type: 'd20', value: 1 }],
            { system: 'dnd5e' }
        );
        expect(fumble.flags.fumble).toBe(true);
    });

    it('advantage crit uses the kept die only', () => {
        const result = evaluateRoll(
            parseNotation('2d20kh1'),
            [
                { groupIndex: 0, dieIndex: 0, type: 'd20', value: 1 },
                { groupIndex: 0, dieIndex: 1, type: 'd20', value: 20 },
            ],
            { system: 'dnd5e' }
        );
        expect(result.flags.crit).toBe(true);
        expect(result.flags.fumble).toBe(false);
        expect(result.flags.advantage).toBe(true);
    });

    it('maps pbta bands to strongHit/crit and miss/fumble', () => {
        const strong = evaluateRoll(
            parseNotation('2d6'),
            [
                { groupIndex: 0, dieIndex: 0, type: 'd6', value: 5 },
                { groupIndex: 0, dieIndex: 1, type: 'd6', value: 6 },
            ],
            { system: 'pbta' }
        );
        expect(strong.total).toBe(11);
        expect(strong.flags.strongHit).toBe(true);
        expect(strong.flags.crit).toBe(true);

        const miss = evaluateRoll(
            parseNotation('2d6'),
            [
                { groupIndex: 0, dieIndex: 0, type: 'd6', value: 1 },
                { groupIndex: 0, dieIndex: 1, type: 'd6', value: 2 },
            ],
            { system: 'pbta' }
        );
        expect(miss.flags.miss).toBe(true);
        expect(miss.flags.fumble).toBe(true);
    });

    it('prefers the replacement value on reroll', () => {
        const parsed = parseNotation('1d6r1');
        const result = evaluateRoll(parsed, [
            { groupIndex: 0, dieIndex: 0, type: 'd6', value: 1, replacedByReroll: true },
            { groupIndex: 0, dieIndex: 0, type: 'd6', value: 4, rerolled: true },
        ]);
        expect(result.total).toBe(4);
    });

    it('includes die/faces/value in the rolls schema', () => {
        const result = evaluateRoll(
            parseNotation('1d20'),
            [{ groupIndex: 0, dieIndex: 0, type: 'd20', value: 12 }],
            { seed: 7 }
        );
        expect(result.rolls.length).toBe(1);
        expect(result.rolls[0].die).toBe('d20');
        expect(result.rolls[0].faces).toBe(20);
        expect(result.rolls[0].value).toBe(12);
        expect(result.seed).toBe(7);
        expect(result.flags).toBeTruthy();
    });

    it('computes coc percentile fumble', () => {
        const parsed = parseNotation('1d100');
        const result = evaluateRoll(
            parsed,
            [
                { groupIndex: 0, dieIndex: 0, type: 'd10', value: 10, role: 'tens' },
                { groupIndex: 0, dieIndex: 1, type: 'd10', value: 6, role: 'ones' },
            ],
            { system: 'coc' }
        );
        // tens 10→0, ones 6→6 => 6, not a fumble
        expect(result.total).toBe(6);
        expect(result.flags.fumble).toBe(false);

        const fumble = evaluateRoll(
            parsed,
            [
                { groupIndex: 0, dieIndex: 0, type: 'd10', value: 9, role: 'tens' },
                { groupIndex: 0, dieIndex: 1, type: 'd10', value: 8, role: 'ones' },
            ],
            { system: 'coc' }
        );
        expect(fumble.total).toBe(98);
        expect(fumble.flags.fumble).toBe(true);
    });
});

describe('respawn specs', () => {
    it('getExplodingRespawnSpecs fires on a max roll', () => {
        const parsed = parseNotation('1d6!');
        const specs = getExplodingRespawnSpecs(parsed, [
            { groupIndex: 0, dieIndex: 0, type: 'd6', value: 6 },
        ]);
        expect(specs.length).toBe(1);
    });

    it('getRerollRespawnSpecs fires on a low face', () => {
        const parsed = parseNotation('2d6r1');
        const specs = getRerollRespawnSpecs(parsed, [
            { groupIndex: 0, dieIndex: 0, type: 'd6', value: 1 },
            { groupIndex: 0, dieIndex: 1, type: 'd6', value: 3 },
        ]);
        expect(specs.length).toBe(1);
        expect(specs[0].dieIndex).toBe(0);
        expect(specs[0].isReroll).toBe(true);
    });
});

describe('display helpers', () => {
    it('formatGroupLabel round-trips group notation', () => {
        const p = parseNotation('2d20kh1');
        expect(formatGroupLabel(p.groups[0])).toBe('2d20kh1');
    });

    it('applyExpressionChip toggles advantage / explode / percentile / reroll1', () => {
        expect(applyExpressionChip('1d20+3', 'advantage')).toBe('2d20kh1+3');
        expect(applyExpressionChip('1d20+3', 'disadvantage')).toBe('2d20kl1+3');
        expect(applyExpressionChip('3d6', 'explode')).toBe('3d6!');
        expect(applyExpressionChip('3d6!', 'compound')).toBe('3d6!!');
        expect(applyExpressionChip('4d6', 'reroll1')).toBe('4d6r1');
        expect(applyExpressionChip('', 'percentile')).toBe('1d100');
    });

    it('defaultExpressionForSystem picks a sane default per ruleset', () => {
        expect(defaultExpressionForSystem('pbta')).toBe('2d6');
        expect(defaultExpressionForSystem('coc')).toBe('1d100');
        expect(defaultExpressionForSystem('savage')).toBe('1d8!');
        expect(defaultExpressionForSystem('dnd5e')).toBe('1d20');
    });
});

// ---------------------------------------------------------------------------
// Property-based tests (fast-check): the parser must never silently return
// garbage. Every generated string either parses into a well-formed
// ParsedRoll (each group has a supported side count and a positive count,
// and evaluateRoll can actually consume it), or parseNotation throws a
// NotationError — never anything else, and never a value that later blows up
// downstream.
// ---------------------------------------------------------------------------

// Read from the parser rather than restated here: the supported sides come from
// DIE_TYPE_CATALOG, so a new derived die type must not need this list edited.
const SUPPORTED_SIDES = [...PARSER_SUPPORTED_SIDES];
const NON_PERCENTILE_SIDES = SUPPORTED_SIDES.filter((n) => n !== 100);

/** A d100/d% term: count must be 1, and no keep/drop/explode/reroll. */
const percentileTermArbitrary = fc.constantFrom('1d100', '1d%');

/** A regular term: sides < 100, reroll threshold (if any) stays below sides. */
const regularTermArbitrary = fc
    .constantFrom(...NON_PERCENTILE_SIDES)
    .chain((sides) =>
        fc.record({
            count: fc.integer({ min: 1, max: 20 }),
            sides: fc.constant(sides),
            keep: fc.constantFrom(null, 'kh', 'kl'),
            keepCount: fc.integer({ min: 1, max: 5 }),
            drop: fc.constantFrom(null, 'dh', 'dl'),
            dropCount: fc.integer({ min: 1, max: 5 }),
            reroll: fc.option(fc.integer({ min: 1, max: sides - 1 }), { nil: null }),
            explode: fc.constantFrom('', '!', '!!'),
        })
    )
    .map(({ count, sides, keep, keepCount, drop, dropCount, reroll, explode }) => {
        let term = `${count}d${sides}`;
        // keep/drop are mutually exclusive in the grammar's own tokenizer group.
        if (keep) term += `${keep}${keepCount}`;
        else if (drop) term += `${drop}${dropCount}`;
        if (reroll != null) term += `r${reroll}`;
        term += explode;
        return term;
    });

const dieTermArbitrary = fc.oneof(regularTermArbitrary, percentileTermArbitrary);

/** Any string at all — including ones that should be rejected. */
const arbitraryJunkArbitrary = fc.string({ maxLength: 24 });

const modifierArbitrary = fc
    .integer({ min: -99, max: 99 })
    .map((n) => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`));

const expressionArbitrary = fc
    .array(dieTermArbitrary, { minLength: 1, maxLength: 3 })
    .chain((terms) => modifierArbitrary.map((modifier) => terms.join('+') + modifier));

describe('parseNotation property tests', () => {
    it('every well-formed generated expression parses to consumable groups', () => {
        fc.assert(
            fc.property(expressionArbitrary, (expr) => {
                const parsed = parseNotation(expr);
                expect(Array.isArray(parsed.groups)).toBe(true);
                expect(parsed.groups.length).toBeGreaterThan(0);
                for (const group of parsed.groups) {
                    expect(SUPPORTED_SIDES).toContain(group.sides);
                    expect(group.count).toBeGreaterThan(0);
                }

                // The parse must be directly evaluable: spawn the same specs
                // the app would (handles percentile's tens/ones pairing) and
                // confirm evaluateRoll never throws or returns NaN.
                const dice = buildSpawnSpecs(parsed).map((spec) => ({
                    groupIndex: spec.groupIndex,
                    dieIndex: spec.dieIndex,
                    type: spec.type,
                    role: spec.role,
                    value: 1,
                }));
                const result = evaluateRoll(parsed, dice);
                expect(Number.isNaN(result.total)).toBe(false);
            }),
            { numRuns: 200 }
        );
    });

    it('every input either parses or throws a NotationError, never anything else', () => {
        fc.assert(
            fc.property(fc.oneof(expressionArbitrary, arbitraryJunkArbitrary), (expr) => {
                try {
                    const parsed = parseNotation(expr);
                    expect(parsed).toBeTruthy();
                    expect(Array.isArray(parsed.groups)).toBe(true);
                } catch (err) {
                    expect(err).toBeInstanceOf(NotationError);
                }
            }),
            { numRuns: 300 }
        );
    });

    it('parses derived die types the catalog derives from shipped hulls', () => {
        for (const [expr, type] of [
            ['2d2', 'd2'],
            ['1d3', 'd3'],
            ['1d5', 'd5'],
        ]) {
            const parsed = parseNotation(expr);
            expect(buildSpawnSpecs(parsed)[0].type).toBe(type);
        }
    });

    it('parses 4dF as Fudge dice on the d6 hull', () => {
        const parsed = parseNotation('4dF');
        expect(parsed.groups[0].fudge).toBe(true);
        expect(parsed.groups[0].count).toBe(4);

        const specs = buildSpawnSpecs(parsed);
        expect(specs).toHaveLength(4);
        expect(specs.every((spec) => spec.type === 'dF')).toBe(true);
    });

    it('sums Fudge faces as the -1/0/+1 the descriptor reports', () => {
        const parsed = parseNotation('4dF+1');
        // readAllDiceValues resolves natural faces through NumberingSpec before
        // evaluation, so what arrives here is already -1/0/+1.
        const dice = buildSpawnSpecs(parsed).map((spec, index) => ({
            groupIndex: spec.groupIndex,
            dieIndex: spec.dieIndex,
            type: spec.type,
            role: spec.role,
            value: [-1, 0, 1, 1][index],
        }));
        expect(evaluateRoll(parsed, dice).total).toBe(2);
    });

    it('labels a Fudge group as dF, not by its hull', () => {
        expect(formatGroupLabel(parseNotation('4dF').groups[0])).toBe('4dF');
    });

    it('rejects explode and reroll on Fudge dice', () => {
        expect(() => parseNotation('4dF!')).toThrow(NotationError);
        expect(() => parseNotation('4dFr1')).toThrow(NotationError);
    });

    it('rejects every string containing an unsupported die size', () => {
        const unsupportedSidesArbitrary = fc
            .integer({ min: 1, max: 30 })
            .filter((n) => !SUPPORTED_SIDES.includes(n));
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10 }),
                unsupportedSidesArbitrary,
                (count, sides) => {
                    expect(() => parseNotation(`${count}d${sides}`)).toThrow(NotationError);
                }
            ),
            { numRuns: 100 }
        );
    });
});
