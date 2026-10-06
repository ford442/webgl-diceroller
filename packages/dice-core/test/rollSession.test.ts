import { describe, expect, it } from 'vitest';
import { createRollSession } from 'dice-core/roll/RollSession';
import type { RollSessionDeps } from 'dice-core/types/roll';

/** A table that reads back a scripted face per throw, die by die. */
function scriptedTable(rounds: number[][]) {
    let specs: { type: string }[] = [];
    let round = -1;
    const spawned: number[] = [];
    const deps: RollSessionDeps = {
        scene: null,
        world: null,
        replaceDiceSet: (_scene, _world, next) => {
            specs = next as { type: string }[];
            spawned.push(next.length);
        },
        throwDice: () => {
            round += 1;
        },
        readAllDiceValues: () =>
            specs.map((spec, i) => ({ type: spec.type, value: rounds[round]?.[i] ?? null })),
        areDiceSettled: () => true,
        waitFrame: () => Promise.resolve(),
    };
    return { deps, spawned };
}

describe('RollSession rounds', () => {
    it('a reroll appends to the pool instead of replacing it (4d6r1)', async () => {
        const { deps, spawned } = scriptedTable([[6, 3, 1, 2], [3]]);
        const result = await createRollSession(deps).roll('4d6r1', 3);
        expect(spawned).toEqual([4, 1]);
        const values = result.dice.map((d) => d.value);
        expect(values).toEqual([6, 3, 1, 2, 3]);
        // The 1 is replaced by its reroll; the other three original dice count.
        expect(result.total).toBe(6 + 3 + 2 + 3);
    });

    it('exploding dice append each round', async () => {
        const { deps, spawned } = scriptedTable([[6, 2], [6], [1]]);
        const result = await createRollSession(deps).roll('2d6!', 1);
        expect(spawned).toEqual([2, 1, 1]);
        expect(result.dice.map((d) => d.value)).toEqual([6, 2, 6, 1]);
        expect(result.total).toBe(15);
    });
});
