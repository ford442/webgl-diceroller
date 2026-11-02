/**
 * Which dice a throw moves (src/dice/DiceThrowSelection.ts): the whole table
 * minus anything held, or exactly the ids a caller names.
 */
import { describe, expect, it } from 'vitest';
import {
    diceIdsForSlots,
    selectThrowDice,
    slotsForDiceIds,
} from '../../src/dice/DiceThrowSelection.js';

const dice = (...entries: Array<[number | null, boolean?]>) =>
    entries.map(([wasmId, kinematic]) => ({ wasmId, kinematic }));

describe('selectThrowDice', () => {
    it('throws every die when nothing is held and no ids are given', () => {
        const table = dice([10], [11], [12]);
        const picked = selectThrowDice(table);
        expect(picked.map((t) => t.id)).toEqual([10, 11, 12]);
        // Index is the position in the throw: it sets the drop height, and it
        // is what keeps R and an old share link bit-identical to before.
        expect(picked.map((t) => t.index)).toEqual([0, 1, 2]);
    });

    it('skips a kinematic (held) die when no ids are given — R never moves the jail', () => {
        const table = dice([10], [11, true], [12]);
        const picked = selectThrowDice(table);
        expect(picked.map((t) => t.id)).toEqual([10, 12]);
        expect(picked.map((t) => t.index)).toEqual([0, 1]);
    });

    it('with ids throws exactly those dice and leaves the rest', () => {
        const table = dice([10], [11], [12], [13]);
        expect(selectThrowDice(table, { ids: [13, 11] }).map((t) => t.id)).toEqual([11, 13]);
    });

    it('keeps table order whatever order the ids arrive in (the RNG draws in table order)', () => {
        const table = dice([10], [11], [12]);
        const a = selectThrowDice(table, { ids: [12, 10] });
        const b = selectThrowDice(table, { ids: [10, 12] });
        expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    });

    it('lets an explicit id name a kinematic die; unnamed kinematic dice stay out', () => {
        const table = dice([10, true], [11, true], [12]);
        expect(selectThrowDice(table, { ids: [10] }).map((t) => t.id)).toEqual([10]);
    });

    it('ignores ids no die has, and an empty list throws nothing', () => {
        const table = dice([10], [11]);
        expect(selectThrowDice(table, { ids: [99] })).toEqual([]);
        expect(selectThrowDice(table, { ids: [] })).toEqual([]);
    });

    it('treats null ids as "no list" (every free die)', () => {
        const table = dice([10], [11, true]);
        expect(selectThrowDice(table, { ids: null }).map((t) => t.id)).toEqual([10]);
    });

    it('falls back to the table slot for a die with no physics body', () => {
        const table = dice([null], [null]);
        expect(selectThrowDice(table).map((t) => t.id)).toEqual([0, 1]);
    });
});

describe('slot <-> id mapping', () => {
    // Body ids are per-session; slots are what a link or a message carries.
    const table = dice([40], [41], [47], [48]);

    it('maps physics ids to ascending table slots', () => {
        expect(slotsForDiceIds(table, [48, 41])).toEqual([1, 3]);
    });

    it("maps slots back to this page's physics ids", () => {
        expect(diceIdsForSlots(table, [1, 3])).toEqual([41, 48]);
    });

    it('round-trips across pages whose body ids differ', () => {
        const hostTable = dice([2], [3], [4], [5]);
        const guestTable = dice([90], [91], [92], [93]);
        const slots = slotsForDiceIds(hostTable, [3, 5]);
        expect(diceIdsForSlots(guestTable, slots)).toEqual([91, 93]);
    });

    it('drops slots with no die', () => {
        expect(diceIdsForSlots(table, [0, 9])).toEqual([40]);
    });
});
