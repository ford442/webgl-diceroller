/**
 * BootTrace: spans, tier summaries, compile totals, first-frame detection.
 */
import { describe, expect, it } from 'vitest';
import { createBootTrace } from '../../src/core/BootTrace.js';
import { createFrameScheduler } from '../../src/core/FrameScheduler.js';

function clocked() {
    let t = 0;
    const trace = createBootTrace({ now: () => t, observeLongTasks: false });
    return { trace, advance: (ms: number) => (t += ms), at: () => t };
}

describe('spans', () => {
    it('records start, end and duration, and ends a span once', () => {
        const { trace, advance } = clocked();
        advance(10);
        const end = trace.begin('Table', 'prop', { slot: 0 });
        advance(25);
        const span = end();
        expect(span).toMatchObject({
            name: 'Table',
            kind: 'prop',
            start: 10,
            end: 35,
            duration: 25,
        });
        advance(100);
        expect(end().duration).toBe(25);
        expect(trace.snapshot().spans).toHaveLength(1);
    });

    it('span() ends on return and on throw; spanAsync() ends when the promise settles', async () => {
        const { trace, advance } = clocked();
        expect(trace.span('sync', 'phase', () => 7)).toBe(7);
        expect(() =>
            trace.span('boom', 'phase', () => {
                advance(3);
                throw new Error('x');
            })
        ).toThrow('x');

        const pending = trace.spanAsync('async', 'phase', async () => {
            advance(40);
            return 'done';
        });
        expect(trace.snapshot().active).toEqual(['phase:async']);
        await expect(pending).resolves.toBe('done');
        await expect(
            trace.spanAsync('reject', 'phase', () => Promise.reject(new Error('no')))
        ).rejects.toThrow('no');

        const byName = Object.fromEntries(trace.snapshot().spans.map((s) => [s.name, s]));
        expect(byName.boom.detail).toEqual({ error: true });
        expect(byName.async.duration).toBe(40);
        expect(byName.reject.detail).toEqual({ error: true });
        expect(trace.snapshot().active).toEqual([]);
    });
});

describe('tiers', () => {
    it('summarises props, the slowest prop, yields and compile time per tier', () => {
        const { trace, advance } = clocked();
        const endTier = trace.beginTier('tier0');
        for (const [name, ms] of [
            ['Table', 30],
            ['Walls', 90],
            ['Candle', 5],
        ] as const) {
            const end = trace.begin(name, 'prop');
            advance(ms);
            end();
        }
        trace.count('yields:tier0', 2);
        const endCompile = trace.begin('compile:tier0', 'compile', { programsAfter: 12 });
        advance(400);
        endCompile();
        endTier();

        const orphan = trace.begin('Outside', 'prop');
        advance(1);
        orphan();

        const snap = trace.snapshot();
        expect(snap.tiers).toHaveLength(1);
        expect(snap.tiers[0]).toMatchObject({
            name: 'tier0',
            props: 3,
            longestProp: 'Walls',
            longestPropMs: 90,
            yields: 2,
            compileMs: 400,
        });
        expect(snap.compile).toMatchObject({
            totalMs: 400,
            longestMs: 400,
            programs: 12,
            passes: 1,
        });
        expect(snap.spans.find((s) => s.name === 'Outside')?.tier).toBeNull();
        expect(trace.format()).toContain('tier0');
        expect(trace.format()).toContain('slowest 90ms (Walls)');
    });

    it('stops keeping spans after ready so a re-rolled layout cannot grow the list', () => {
        const { trace, advance } = clocked();
        trace.begin('before', 'prop')();
        advance(5);
        trace.markReady();
        trace.begin('after', 'prop')();
        const snap = trace.snapshot();
        expect(snap.ready).toBe(5);
        expect(snap.spans.map((s) => s.name)).toEqual(['before']);
    });
});

describe('frame watch', () => {
    it('does not call a held frame the first render, then records the first drawn frame and its new programs', () => {
        const { trace, advance } = clocked();
        const scheduler = createFrameScheduler();
        let programs = 10;
        trace.attachScheduler(scheduler, { getProgramCount: () => programs });
        scheduler.register('render', 'draw', () => {
            advance(20);
            programs += 3;
        });

        const hold = scheduler.holdPhase('render', 'boot');
        scheduler.runFrame({ deltaTime: 1 / 60, time: 0 });
        expect(trace.snapshot().firstFrame).toBeNull();
        expect(trace.snapshot().frames[0]).toMatchObject({ n: 1, rendered: false });

        hold.release();
        advance(100);
        scheduler.runFrame({ deltaTime: 1 / 60, time: 0 });
        const snap = trace.snapshot();
        expect(snap.firstFrame).toMatchObject({ duration: 20, newPrograms: 3 });
        expect(snap.frames[1]).toMatchObject({ n: 2, rendered: true, newPrograms: 3 });
    });

    it('removes its scheduler systems once it has watched enough rendered frames', () => {
        const trace = createBootTrace({ now: () => 0, observeLongTasks: false, maxFrames: 2 });
        const scheduler = createFrameScheduler();
        trace.attachScheduler(scheduler);
        scheduler.register('render', 'draw', () => {});
        for (let i = 0; i < 5; i += 1) scheduler.runFrame({ deltaTime: 1 / 60, time: 0 });
        expect(trace.snapshot().frames).toHaveLength(2);
    });

    it('samples held frames instead of recording every one of a long boot', () => {
        const trace = createBootTrace({ now: () => 0, observeLongTasks: false, maxFrames: 3 });
        const scheduler = createFrameScheduler();
        trace.attachScheduler(scheduler);
        scheduler.register('render', 'draw', () => {});
        const hold = scheduler.holdPhase('render', 'boot');
        for (let i = 0; i < 500; i += 1) scheduler.runFrame({ deltaTime: 1 / 60, time: 0 });
        const held = trace.snapshot();
        expect(held.frames.length).toBeLessThanOrEqual(8);
        expect(held.counters.heldFrames).toBe(500);
        expect(held.firstFrame).toBeNull();

        hold.release();
        for (let i = 0; i < 4; i += 1) scheduler.runFrame({ deltaTime: 1 / 60, time: 0 });
        const after = trace.snapshot();
        expect(after.firstFrame).not.toBeNull();
        expect(after.frames.filter((f) => f.rendered)).toHaveLength(3);
        expect(after.frames[after.frames.length - 1]?.n).toBe(503);
    });
});
