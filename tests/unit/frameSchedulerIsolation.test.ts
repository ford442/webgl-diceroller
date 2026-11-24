/**
 * A failing system must not end the frame: the others run, the render phase
 * still draws, the error goes to the boundary once per throw (the reporter
 * dedupes), and a system that keeps failing is switched off.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFrameScheduler } from '../../src/core/FrameScheduler.js';

const FRAME = { deltaTime: 1 / 60, time: 0 };

describe('FrameScheduler system isolation', () => {
    it('runs the rest of the frame when a system throws', () => {
        const onSystemError = vi.fn();
        const scheduler = createFrameScheduler({ onSystemError });
        const after = vi.fn();
        const render = vi.fn();
        scheduler.register('updates', 'bad', () => {
            throw new Error('prop update broke');
        });
        scheduler.register('updates', 'good', after, { priority: 1 });
        scheduler.register('render', 'draw', render);

        expect(() => scheduler.runFrame(FRAME)).not.toThrow();
        expect(after).toHaveBeenCalledTimes(1);
        expect(render).toHaveBeenCalledTimes(1);
        expect(onSystemError).toHaveBeenCalledTimes(1);
        expect(onSystemError.mock.calls[0]?.[1]).toMatchObject({
            system: 'bad',
            phase: 'updates',
            consecutive: 1,
            quarantined: false,
        });
        expect(scheduler.stats.systemErrors.bad).toBe(1);
    });

    it('switches a system off after maxConsecutiveFailures and reports it', () => {
        const onSystemError = vi.fn();
        const scheduler = createFrameScheduler({ onSystemError, maxConsecutiveFailures: 3 });
        const bad = vi.fn(() => {
            throw new Error('always');
        });
        scheduler.register('updates', 'bad', bad);

        for (let i = 0; i < 10; i++) scheduler.runFrame(FRAME);

        expect(bad).toHaveBeenCalledTimes(3);
        expect(onSystemError).toHaveBeenCalledTimes(3);
        expect(onSystemError.mock.calls[2]?.[1]).toMatchObject({
            consecutive: 3,
            quarantined: true,
        });
        expect(scheduler.stats.quarantined).toEqual(['bad']);
    });

    it('a clean run resets the failure streak', () => {
        const scheduler = createFrameScheduler({
            onSystemError: () => {},
            maxConsecutiveFailures: 3,
        });
        let n = 0;
        const flaky = vi.fn(() => {
            n += 1;
            // throw, throw, ok, throw, throw, ok ... never three in a row
            if (n % 3 !== 0) throw new Error('flaky');
        });
        scheduler.register('updates', 'flaky', flaky);
        for (let i = 0; i < 12; i++) scheduler.runFrame(FRAME);
        expect(flaky).toHaveBeenCalledTimes(12);
        expect(scheduler.stats.quarantined).toEqual([]);
    });

    it('never switches the render phase off: drawing is retried every frame', () => {
        const scheduler = createFrameScheduler({
            onSystemError: () => {},
            maxConsecutiveFailures: 2,
        });
        const draw = vi.fn(() => {
            throw new Error('context lost');
        });
        scheduler.register('render', 'draw', draw);
        for (let i = 0; i < 6; i++) scheduler.runFrame(FRAME);
        expect(draw).toHaveBeenCalledTimes(6);
        expect(scheduler.stats.quarantined).toEqual([]);
    });

    it('still resolves nextFrame() on a frame where a system threw', async () => {
        const scheduler = createFrameScheduler({ onSystemError: () => {} });
        scheduler.register('updates', 'bad', () => {
            throw new Error('x');
        });
        const waiting = scheduler.nextFrame();
        scheduler.runFrame(FRAME);
        await expect(waiting).resolves.toBeUndefined();
    });

    it('re-enabling a switched-off system clears its quarantine', () => {
        const scheduler = createFrameScheduler({
            onSystemError: () => {},
            maxConsecutiveFailures: 1,
        });
        let broken = true;
        const fn = vi.fn(() => {
            if (broken) throw new Error('x');
        });
        const handle = scheduler.register('updates', 'sys', fn);
        scheduler.runFrame(FRAME);
        expect(scheduler.stats.quarantined).toEqual(['sys']);
        broken = false;
        handle.enable();
        scheduler.runFrame(FRAME);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(scheduler.stats.quarantined).toEqual([]);
    });

    it('survives an onSystemError handler that itself throws', () => {
        const scheduler = createFrameScheduler({
            onSystemError: () => {
                throw new Error('handler broke');
            },
        });
        const after = vi.fn();
        scheduler.register('updates', 'bad', () => {
            throw new Error('x');
        });
        scheduler.register('updates', 'good', after, { priority: 1 });
        expect(() => scheduler.runFrame(FRAME)).not.toThrow();
        expect(after).toHaveBeenCalled();
    });

    it('without a handler, logs each failing system once, not once per frame', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const scheduler = createFrameScheduler({ maxConsecutiveFailures: 1000 });
            scheduler.register('updates', 'bad', () => {
                throw new Error('x');
            });
            for (let i = 0; i < 50; i++) scheduler.runFrame(FRAME);
            expect(spy).toHaveBeenCalledTimes(1);
        } finally {
            spy.mockRestore();
        }
    });
});
