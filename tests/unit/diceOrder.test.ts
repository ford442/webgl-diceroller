import { describe, expect, it } from 'vitest';
import { reorderToTypeSequence } from '../../src/app/diceOrder';

const dice = (types: string[]) => types.map((type, id) => ({ type, id }));

describe('reorderToTypeSequence', () => {
    it('restores the order a game left shuffled (d6 first, removed types appended)', () => {
        const items = dice(['d6', 'd6', 'd4', 'd8']);
        reorderToTypeSequence(items, ['d4', 'd6', 'd6', 'd8']);
        expect(items.map((d) => d.type)).toEqual(['d4', 'd6', 'd6', 'd8']);
    });

    it('keeps same-type dice in their relative order', () => {
        const items = dice(['d6', 'd6', 'd4']);
        reorderToTypeSequence(items, ['d6', 'd4', 'd6']);
        expect(items.map((d) => d.id)).toEqual([0, 2, 1]);
    });

    it('keeps surplus and unknown dice after the placed ones', () => {
        const items = dice(['d20', 'd6', 'd6']);
        reorderToTypeSequence(items, ['d6']);
        expect(items.map((d) => d.type)).toEqual(['d6', 'd20', 'd6']);
    });

    it('is a no-op on an empty sequence and mutates in place', () => {
        const items = dice(['d4', 'd6']);
        const ref = items;
        reorderToTypeSequence(items, []);
        expect(ref).toBe(items);
        expect(items.map((d) => d.type)).toEqual(['d4', 'd6']);
    });
});
