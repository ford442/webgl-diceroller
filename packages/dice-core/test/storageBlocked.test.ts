/**
 * With storage blocked (private mode, cookies off) merely naming `localStorage`
 * throws a SecurityError. History, stats and the dice set must keep working
 * in memory instead of taking the app's boot down (#383).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRollHistory } from 'dice-core/roll/RollHistory';
import { createRollStats } from 'dice-core/roll/RollStats';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        },
    });
});

afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
});

describe('blocked storage', () => {
    it('RollHistory loads and saves without throwing', () => {
        expect(() => {
            const history = createRollHistory();
            history.clear?.();
        }).not.toThrow();
    });

    it('RollStats loads and saves without throwing', () => {
        const stats = createRollStats();
        expect(() =>
            stats.recordResults([{ type: 'd6', value: 3, sides: 6 } as never])
        ).not.toThrow();
    });
});
