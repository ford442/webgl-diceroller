import { describe, expect, it, vi } from 'vitest';
import { createErrorReporter, describeError } from '../../src/core/ErrorReporter.js';

function throwAt(message: string): Error {
    try {
        throw new Error(message);
    } catch (e) {
        return e as Error;
    }
}

describe('ErrorReporter', () => {
    it('logs a failure once and counts its repeats', () => {
        const log = vi.fn();
        const onFirst = vi.fn();
        const reporter = createErrorReporter({ log, onFirst });

        const error = throwAt('boom');
        expect(reporter.report('system', error, 'lamp').first).toBe(true);
        for (let i = 0; i < 1000; i++) reporter.report('system', error, 'lamp');

        expect(log).toHaveBeenCalledTimes(1);
        expect(onFirst).toHaveBeenCalledTimes(1);
        expect(reporter.total()).toBe(1001);
        expect(reporter.list()).toHaveLength(1);
        expect(reporter.list()[0]).toMatchObject({ kind: 'system', source: 'lamp', count: 1001 });
    });

    it('keeps different sources, messages and kinds apart', () => {
        const log = vi.fn();
        const reporter = createErrorReporter({ log });
        reporter.report('system', throwAt('x'), 'a');
        reporter.report('system', throwAt('x'), 'b');
        reporter.report('system', throwAt('y'), 'a');
        reporter.report('rejection', throwAt('x'), 'a');
        expect(log).toHaveBeenCalledTimes(4);
        expect(reporter.list()).toHaveLength(4);
    });

    it('forgets the oldest distinct failure past maxEntries but keeps counting', () => {
        const reporter = createErrorReporter({ log: () => {}, maxEntries: 3 });
        for (let i = 0; i < 10; i++) reporter.report('error', `e${i}`, 'w');
        expect(reporter.list().map((e) => e.message)).toEqual(['e7', 'e8', 'e9']);
        expect(reporter.total()).toBe(10);
    });

    it('describes whatever was thrown without throwing itself', () => {
        expect(describeError('plain').message).toBe('plain');
        expect(describeError({ message: 'obj' }).message).toBe('obj');
        expect(describeError(undefined).message).toBe('undefined');
        expect(describeError(null).message).toBe('null');
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => describeError(cyclic)).not.toThrow();
    });

    it('clear() resets entries and the total', () => {
        const reporter = createErrorReporter({ log: () => {} });
        reporter.report('error', 'a');
        reporter.clear();
        expect(reporter.list()).toEqual([]);
        expect(reporter.total()).toBe(0);
        expect(reporter.report('error', 'a').first).toBe(true);
    });
});
