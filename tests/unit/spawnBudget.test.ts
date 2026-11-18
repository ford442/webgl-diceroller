/**
 * SpawnBudget: yields between units of boot work once a frame's slice is spent,
 * on the scheduler's frame clock, with bounded waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameScheduler } from '../../src/core/FrameScheduler.js';
import {
    DEFAULT_SPAWN_BUDGETS,
    createSpawnBudget,
    resolveSpawnBudgets,
} from '../../src/core/SpawnBudget.js';

function fakeClock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createSpawnBudget', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('does not yield while the slice is inside its budget', () => {
        const clock = fakeClock();
        const scheduler = createFrameScheduler();
        const budget = createSpawnBudget({
            scheduler,
            budgetMs: 6,
            now: clock.now,
            isHidden: () => false,
        });
        clock.advance(5);
        expect(budget.checkpoint()).toBeUndefined();
        expect(budget.stats().yields).toBe(0);
    });

    it("waits for the scheduler's next frame once the budget is spent, then starts a new slice", async () => {
        const clock = fakeClock();
        const scheduler = createFrameScheduler();
        const budget = createSpawnBudget({
            scheduler,
            budgetMs: 6,
            now: clock.now,
            isHidden: () => false,
        });

        clock.advance(7);
        const resumed = vi.fn();
        const pending = budget.checkpoint();
        expect(pending).toBeInstanceOf(Promise);
        void (pending as Promise<void>).then(resumed);

        await Promise.resolve();
        expect(resumed).not.toHaveBeenCalled();

        scheduler.runFrame({ deltaTime: 1 / 60, time: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(resumed).toHaveBeenCalledTimes(1);

        // A fresh slice began at resume: 5 ms more is inside the budget again.
        clock.advance(5);
        expect(budget.checkpoint()).toBeUndefined();
        expect(budget.stats()).toMatchObject({ yields: 1, watchdogYields: 0 });
        expect(budget.stats().longestSliceMs).toBe(7);
    });

    it('bounds the wait with a watchdog when no frame ever runs', async () => {
        const clock = fakeClock();
        const scheduler = createFrameScheduler();
        const counts: Record<string, number> = {};
        const budget = createSpawnBudget({
            scheduler,
            budgetMs: 6,
            now: clock.now,
            isHidden: () => false,
            watchdogMs: 250,
            trace: { count: (name, delta = 1) => (counts[name] = (counts[name] ?? 0) + delta) },
            label: 'tier1',
        });
        clock.advance(10);
        const resumed = vi.fn();
        void (budget.checkpoint() as Promise<void>).then(resumed);

        await vi.advanceTimersByTimeAsync(249);
        expect(resumed).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(resumed).toHaveBeenCalledTimes(1);
        expect(budget.stats().watchdogYields).toBe(1);
        expect(counts).toEqual({ 'yields:tier1': 1, watchdogYields: 1 });
    });

    it('does not wait for a frame in a hidden tab (rAF is paused there)', () => {
        const clock = fakeClock();
        const scheduler = createFrameScheduler();
        const budget = createSpawnBudget({
            scheduler,
            budgetMs: 6,
            now: clock.now,
            isHidden: () => true,
        });
        clock.advance(50);
        expect(budget.checkpoint()).toBeUndefined();
        expect(budget.stats()).toMatchObject({ yields: 0, hiddenSkips: 1, longestSliceMs: 50 });
    });

    it('never yields at budget 0 (the old behaviour)', () => {
        const clock = fakeClock();
        const budget = createSpawnBudget({
            scheduler: createFrameScheduler(),
            budgetMs: 0,
            now: clock.now,
            isHidden: () => false,
        });
        clock.advance(10_000);
        expect(budget.checkpoint()).toBeUndefined();
    });

    it('configure() changes the budget and starts a fresh slice', () => {
        const clock = fakeClock();
        const budget = createSpawnBudget({
            scheduler: createFrameScheduler(),
            budgetMs: 6,
            now: clock.now,
            isHidden: () => false,
        });
        clock.advance(100);
        budget.configure(16, 'tier0');
        expect(budget.budgetMs).toBe(16);
        clock.advance(15);
        expect(budget.checkpoint()).toBeUndefined();
    });
});

describe('resolveSpawnBudgets', () => {
    it('defaults to a larger tier 0 than the later tiers', () => {
        const budgets = resolveSpawnBudgets(new URLSearchParams(''));
        expect(budgets).toEqual(DEFAULT_SPAWN_BUDGETS);
        expect(budgets.tier0).toBeGreaterThan(budgets.tier1);
    });

    it('?spawn-budget=N sets every tier, 0 disables, and garbage falls back to the defaults', () => {
        expect(resolveSpawnBudgets(new URLSearchParams('spawn-budget=3'))).toEqual({
            tier0: 3,
            tier1: 3,
            decor: 3,
        });
        expect(resolveSpawnBudgets(new URLSearchParams('spawn-budget=0')).tier1).toBe(0);
        for (const bad of ['spawn-budget=', 'spawn-budget=abc', 'spawn-budget=-4']) {
            expect(resolveSpawnBudgets(new URLSearchParams(bad))).toEqual(DEFAULT_SPAWN_BUDGETS);
        }
    });
});
