/**
 * Unit tests for roll history tracking (RollHistory.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_MAX_ENTRIES,
    DICE_TYPE_ORDER,
    createRollHistory,
    formatDiceSet,
    formatResultsSummary,
} from '../../src/roll/RollHistory.js';

beforeEach(() => {
    localStorage.clear();
});

describe('constants', () => {
    it('DICE_TYPE_ORDER lists the six supported dice', () => {
        expect(DICE_TYPE_ORDER).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
    });

    it('DEFAULT_MAX_ENTRIES is 500', () => {
        expect(DEFAULT_MAX_ENTRIES).toBe(500);
    });
});

describe('formatDiceSet', () => {
    it('returns empty string for null/non-object input', () => {
        expect(formatDiceSet(null)).toBe('');
        expect(formatDiceSet(undefined)).toBe('');
        // @ts-expect-error intentional bad type
        expect(formatDiceSet('nope')).toBe('');
        // @ts-expect-error intentional bad type
        expect(formatDiceSet(42)).toBe('');
    });

    it('only includes types with count > 0, in DICE_TYPE_ORDER, joined by " + "', () => {
        expect(formatDiceSet({ d6: 2, d20: 1 })).toBe('2d6 + 1d20');
        expect(formatDiceSet({ d20: 1, d6: 2 })).toBe('2d6 + 1d20'); // order independent of input order
        expect(formatDiceSet({ d6: 0, d8: 3 })).toBe('3d8');
        expect(formatDiceSet({})).toBe('');
    });
});

describe('formatResultsSummary', () => {
    it('groups by die type in DICE_TYPE_ORDER', () => {
        const summary = formatResultsSummary([
            { type: 'd20', value: 15 },
            { type: 'd6', value: 3 },
            { type: 'd6', value: 4 },
        ]);
        expect(summary).toBe('2d6: 3, 4  •  1d20: 15');
    });

    it('ignores entries with non-integer value or missing type', () => {
        const summary = formatResultsSummary([
            { type: 'd6', value: 3 },
            { type: 'd6', value: 3.5 } as any,
            { value: 4 } as any,
            { type: null, value: 2 } as any,
        ]);
        expect(summary).toBe('1d6: 3');
    });

    it('returns empty string for no valid results', () => {
        expect(formatResultsSummary([])).toBe('');
    });
});

describe('createRollHistory: appendRoll validation', () => {
    it('returns null and adds nothing for null/undefined/empty array', () => {
        const history = createRollHistory({ storageKey: 'test-hist-1', persist: false });
        expect(history.appendRoll(null)).toBeNull();
        expect(history.appendRoll(undefined)).toBeNull();
        expect(history.appendRoll([])).toBeNull();
        expect(history.getEntries()).toEqual([]);
    });

    it('returns null when every result lacks an integer value', () => {
        const history = createRollHistory({ storageKey: 'test-hist-2', persist: false });
        const result = history.appendRoll([
            { type: 'd6', value: 3.5 } as any,
            { type: 'd6' } as any,
        ]);
        expect(result).toBeNull();
        expect(history.getEntries()).toEqual([]);
    });
});

describe('createRollHistory: appendRoll behavior', () => {
    it('computes total as the sum of valid results, ignoring invalid ones mixed in', () => {
        const history = createRollHistory({ storageKey: 'test-hist-3', persist: false });
        const entry = history.appendRoll([
            { type: 'd6', value: 3 },
            { type: 'd6', value: 4.5 } as any,
            { type: 'd20', value: 10 },
        ]);
        expect(entry).not.toBeNull();
        expect(entry!.total).toBe(13); // 3 + 10, ignoring the non-integer
        expect(entry!.diceResults).toEqual([
            { type: 'd6', value: 3 },
            { type: 'd20', value: 10 },
        ]);
    });

    it('assigns sequential ids like roll-1, roll-2, ...', () => {
        const history = createRollHistory({ storageKey: 'test-hist-4', persist: false });
        const e1 = history.appendRoll([{ type: 'd6', value: 1 }]);
        const e2 = history.appendRoll([{ type: 'd6', value: 2 }]);
        const e3 = history.appendRoll([{ type: 'd6', value: 3 }]);
        expect(e1!.id).toBe('roll-1');
        expect(e2!.id).toBe('roll-2');
        expect(e3!.id).toBe('roll-3');
    });

    it('defaults seed/expression to null and diceSet to {} when meta omits them', () => {
        const history = createRollHistory({ storageKey: 'test-hist-5', persist: false });
        const entry = history.appendRoll([{ type: 'd6', value: 5 }]);
        expect(entry!.seed).toBeNull();
        expect(entry!.expression).toBeNull();
        expect(entry!.diceSet).toEqual({});
    });

    it('uses provided meta fields when present', () => {
        const history = createRollHistory({ storageKey: 'test-hist-6', persist: false });
        const entry = history.appendRoll([{ type: 'd6', value: 5 }], {
            diceSet: { d6: 1 },
            seed: 42,
            expression: '1d6',
        });
        expect(entry!.seed).toBe(42);
        expect(entry!.expression).toBe('1d6');
        expect(entry!.diceSet).toEqual({ d6: 1 });
    });

    it('prepends entries so getEntries()[0] is the most recent', () => {
        const history = createRollHistory({ storageKey: 'test-hist-7', persist: false });
        history.appendRoll([{ type: 'd6', value: 1 }]);
        history.appendRoll([{ type: 'd6', value: 2 }]);
        const last = history.appendRoll([{ type: 'd6', value: 3 }]);
        const entries = history.getEntries();
        expect(entries[0].id).toBe(last!.id);
        expect(entries.map((e) => e.id)).toEqual(['roll-3', 'roll-2', 'roll-1']);
    });
});

describe('createRollHistory: capping', () => {
    it('never exceeds maxEntries and drops the oldest entries first', () => {
        const history = createRollHistory({
            storageKey: 'test-hist-8',
            persist: false,
            maxEntries: 3,
        });
        for (let i = 1; i <= 5; i++) {
            history.appendRoll([{ type: 'd6', value: 1 }]);
        }
        const entries = history.getEntries();
        expect(entries).toHaveLength(3);
        // Most recent first: roll-5, roll-4, roll-3 (roll-1 and roll-2 dropped)
        expect(entries.map((e) => e.id)).toEqual(['roll-5', 'roll-4', 'roll-3']);
    });
});

describe('createRollHistory: getEntries defensive copy', () => {
    it('mutating the returned array/objects does not affect subsequent calls', () => {
        const history = createRollHistory({ storageKey: 'test-hist-9', persist: false });
        history.appendRoll([{ type: 'd6', value: 4 }]);

        const entries = history.getEntries();
        entries.push({ ...entries[0], id: 'roll-fake' });
        entries[0].total = 9999;
        entries[0].diceResults.push({ type: 'd20', value: 20 });

        const fresh = history.getEntries();
        expect(fresh).toHaveLength(1);
        expect(fresh[0].total).toBe(4);
        expect(fresh[0].diceResults).toEqual([{ type: 'd6', value: 4 }]);
    });
});

describe('createRollHistory: clear', () => {
    it('empties history and persists that', () => {
        const key = 'test-hist-10';
        const history = createRollHistory({ storageKey: key, persist: true });
        history.appendRoll([{ type: 'd6', value: 4 }]);
        history.clear();
        expect(history.getEntries()).toEqual([]);

        const reloaded = createRollHistory({ storageKey: key, persist: true });
        expect(reloaded.getEntries()).toEqual([]);
    });
});

describe('createRollHistory: exportAsText', () => {
    it('returns "No rolls recorded." when empty', () => {
        const history = createRollHistory({ storageKey: 'test-hist-11', persist: false });
        expect(history.exportAsText()).toBe('No rolls recorded.');
    });

    it('includes the total and seed=/expr= markers when present', () => {
        const history = createRollHistory({ storageKey: 'test-hist-12', persist: false });
        history.appendRoll([{ type: 'd6', value: 3 }], { seed: 7, expression: '1d6' });
        const text = history.exportAsText();
        expect(text).toContain('Total: 3');
        expect(text).toContain('seed=7');
        expect(text).toContain('expr=1d6');
    });

    it('omits seed=/expr= markers when absent', () => {
        const history = createRollHistory({ storageKey: 'test-hist-13', persist: false });
        history.appendRoll([{ type: 'd6', value: 3 }]);
        const text = history.exportAsText();
        expect(text).not.toContain('seed=');
        expect(text).not.toContain('expr=');
    });
});

describe('createRollHistory: exportAsCsv', () => {
    it('returns a header row plus one row per entry', () => {
        const history = createRollHistory({ storageKey: 'test-hist-14', persist: false });
        history.appendRoll([{ type: 'd6', value: 3 }]);
        history.appendRoll([{ type: 'd20', value: 15 }]);
        const csv = history.exportAsCsv();
        const lines = csv.split('\n');
        expect(lines[0]).toBe('timestamp,dice_set,results,total,seed,expression');
        expect(lines).toHaveLength(3);
    });

    it('CSV-escapes a results field containing a comma', () => {
        const history = createRollHistory({ storageKey: 'test-hist-15', persist: false });
        history.appendRoll([
            { type: 'd6', value: 3 },
            { type: 'd6', value: 4 },
        ]);
        const csv = history.exportAsCsv();
        // formatResultsSummary for two d6 results is "2d6: 3, 4" which contains a comma
        // and must be wrapped in quotes per escapeCsv.
        expect(csv).toContain('"2d6: 3, 4"');
    });

    it('CSV-escapes and doubles internal quotes via formatDiceSet/formatResultsSummary values', () => {
        // formatDiceSet/formatResultsSummary never themselves emit quote characters,
        // so we verify escaping behavior indirectly through a value we control: expression.
        const history = createRollHistory({ storageKey: 'test-hist-16', persist: false });
        history.appendRoll([{ type: 'd6', value: 3 }], { expression: 'say "hi", ok' });
        const csv = history.exportAsCsv();
        expect(csv).toContain('"say ""hi"", ok"');
    });
});

describe('createRollHistory: persistence', () => {
    it('round-trips appended rolls through localStorage with a custom storageKey', () => {
        const key = 'test-hist-persist-1';
        const first = createRollHistory({ storageKey: key, persist: true });
        first.appendRoll([{ type: 'd6', value: 3 }]);
        first.appendRoll([{ type: 'd20', value: 15 }]);

        const second = createRollHistory({ storageKey: key, persist: true });
        const entries = second.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries[0].total).toBe(15);
        expect(entries[1].total).toBe(3);
    });

    it('writes nothing to localStorage when persist is false', () => {
        const key = 'test-hist-persist-2';
        const history = createRollHistory({ storageKey: key, persist: false });
        history.appendRoll([{ type: 'd6', value: 3 }]);
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('falls back to an empty, non-throwing history when localStorage has malformed JSON', () => {
        const key = 'test-hist-persist-3';
        localStorage.setItem(key, 'not json');
        let history: ReturnType<typeof createRollHistory>;
        expect(() => {
            history = createRollHistory({ storageKey: key, persist: true });
        }).not.toThrow();
        expect(history!.getEntries()).toEqual([]);
    });

    it('nextId continues from the max roll-N id found in loaded entries', () => {
        const key = 'test-hist-persist-4';
        const first = createRollHistory({ storageKey: key, persist: true });
        first.appendRoll([{ type: 'd6', value: 1 }]); // roll-1
        first.appendRoll([{ type: 'd6', value: 2 }]); // roll-2
        first.appendRoll([{ type: 'd6', value: 3 }]); // roll-3

        const second = createRollHistory({ storageKey: key, persist: true });
        const entry = second.appendRoll([{ type: 'd6', value: 4 }]);
        expect(entry!.id).toBe('roll-4');
    });
});
