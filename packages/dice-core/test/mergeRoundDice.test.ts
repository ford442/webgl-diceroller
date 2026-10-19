/**
 * mergeRoundDice backs both RollSession (the app's notation rolls) and
 * rollHeadless. Its predecessor, copied into both, treated the reroll round as
 * the first round and threw away every die it did not reroll: `4d6r1` with
 * one 1 came back as a single die.
 */
import { describe, expect, it } from 'vitest';
import {
    evaluateRoll,
    getRerollRespawnSpecs,
    mergeRoundDice,
    parseNotation,
    type DieOutcome,
} from 'dice-core/roll/Notation';

const d6 = (dieIndex: number, value: number, extra: Partial<DieOutcome> = {}): DieOutcome => ({
    groupIndex: 0,
    dieIndex,
    type: 'd6',
    value,
    role: null,
    ...extra,
});

describe('mergeRoundDice', () => {
    it('keeps the dice a reroll round did not touch', () => {
        const parsed = parseNotation('4d6r1');
        const side = { groups: parsed.groups, modifier: parsed.modifier, raw: parsed.raw };
        const dice: DieOutcome[] = [];
        mergeRoundDice(dice, [d6(0, 3), d6(1, 1), d6(2, 6), d6(3, 5)], [], true);

        const specs = getRerollRespawnSpecs(side, dice);
        expect(specs.map((s) => s.dieIndex)).toEqual([1]);
        mergeRoundDice(dice, [d6(0, 4, { rerolled: true })], specs, false);

        expect(dice).toHaveLength(5);
        expect(dice[1]).toMatchObject({ replacedByReroll: true, dropped: true, originalValue: 1 });
        expect(dice[4]).toMatchObject({ dieIndex: 1, value: 4, rerolled: true, originalValue: 1 });
        // Nothing left to reroll: the replaced die is not offered again.
        expect(getRerollRespawnSpecs(side, dice)).toEqual([]);
        expect(evaluateRoll(parsed, dice, { seed: 1 }).total).toBe(3 + 4 + 6 + 5);
    });

    it('appends explosions under the slot they came from', () => {
        const dice: DieOutcome[] = [];
        mergeRoundDice(dice, [d6(0, 6), d6(1, 2)], [], true);
        const specs = [
            { type: 'd6', role: null, groupIndex: 0, dieIndex: 0, explode: true, sides: 6 },
        ];
        mergeRoundDice(dice, [d6(0, 3)], specs, false);
        expect(dice).toHaveLength(3);
        expect(dice[2]).toMatchObject({ dieIndex: 0, value: 3, exploded: true });
    });

    it('lets the caller carry its own data across the clones', () => {
        const meta = new WeakMap<DieOutcome, string>();
        const first = d6(0, 1);
        meta.set(first, 'first');
        const dice: DieOutcome[] = [];
        mergeRoundDice(dice, [first], [], true);
        const reroll = d6(0, 5);
        meta.set(reroll, 'reroll');
        mergeRoundDice(
            dice,
            [reroll],
            [
                {
                    type: 'd6',
                    role: null,
                    groupIndex: 0,
                    dieIndex: 0,
                    explode: false,
                    sides: 6,
                    isReroll: true,
                },
            ],
            false,
            (from, to) => (meta.set(to, meta.get(from)!), to)
        );
        expect(dice.map((d) => meta.get(d))).toEqual(['first', 'reroll']);
    });
});
