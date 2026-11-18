/**
 * FrameScheduler.holdPhase / nextFrame: the two primitives the boot budget is
 * built on (hold `render` while shaders link; pay spawn work a slice per frame).
 */
import { describe, expect, it, vi } from 'vitest';
import { createFrameScheduler } from '../../src/core/FrameScheduler.js';

const FRAME = { deltaTime: 1 / 60, time: 0 };

describe('holdPhase', () => {
    it('skips the held phase but still runs the others, and counts the frame as held', () => {
        const scheduler = createFrameScheduler();
        const render = vi.fn();
        const updates = vi.fn();
        scheduler.register('render', 'draw', render);
        scheduler.register('updates', 'tick', updates);

        const hold = scheduler.holdPhase('render', 'test');
        scheduler.runFrame(FRAME);
        expect(render).not.toHaveBeenCalled();
        expect(updates).toHaveBeenCalledTimes(1);
        expect(scheduler.stats.heldFrames).toBe(1);

        hold.release();
        scheduler.runFrame(FRAME);
        expect(render).toHaveBeenCalledTimes(1);
        expect(scheduler.stats.heldFrames).toBe(1);
    });

    it('stays held until every hold is released, and release is idempotent', () => {
        const scheduler = createFrameScheduler();
        const render = vi.fn();
        scheduler.register('render', 'draw', render);

        const a = scheduler.holdPhase('render', 'a');
        const b = scheduler.holdPhase('render', 'b');
        expect(scheduler.phaseHoldReasons('render')).toEqual(['a', 'b']);

        a.release();
        a.release();
        scheduler.runFrame(FRAME);
        expect(render).not.toHaveBeenCalled();
        expect(scheduler.isPhaseHeld('render')).toBe(true);

        b.release();
        expect(scheduler.isPhaseHeld('render')).toBe(false);
        scheduler.runFrame(FRAME);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('does not count a frame as held when the held phase has no systems', () => {
        const scheduler = createFrameScheduler();
        scheduler.holdPhase('render', 'nothing registered');
        scheduler.runFrame(FRAME);
        expect(scheduler.stats.heldFrames).toBe(0);
    });
});

describe('nextFrame', () => {
    it('resolves when the frame running now finishes, not before', async () => {
        const scheduler = createFrameScheduler();
        const order: string[] = [];
        scheduler.register('updates', 'asks', () => {
            void scheduler.nextFrame().then(() => order.push('resolved'));
            order.push('asked');
        });
        scheduler.register('postRender', 'last', () => order.push('postRender'));

        scheduler.runFrame(FRAME);
        expect(order).toEqual(['asked', 'postRender']);
        await Promise.resolve();
        expect(order).toEqual(['asked', 'postRender', 'resolved']);
    });

    it('resolves every waiter once, and waiters from a later request wait for a later frame', async () => {
        const scheduler = createFrameScheduler();
        const first = vi.fn();
        const second = vi.fn();
        void scheduler.nextFrame().then(first);
        void scheduler.nextFrame().then(first);
        scheduler.runFrame(FRAME);
        await Promise.resolve();
        expect(first).toHaveBeenCalledTimes(2);

        void scheduler.nextFrame().then(second);
        await Promise.resolve();
        expect(second).not.toHaveBeenCalled();
        scheduler.runFrame(FRAME);
        await Promise.resolve();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
