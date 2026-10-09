/**
 * A roll always ends (#341): SettleWatch reports `settled` only for a real
 * rest after the throw, and `timedOut` — never an endless `pending` — when the
 * dice will not sleep, the engine stops ticking, or bodies never register.
 */
import { describe, expect, it } from 'vitest';
import { createSettleWatch, type SettleProbe } from '../../src/core-engine/roll/SettleWatch.js';

function makeWorld(overrides: Partial<{ expected: number; engine: number; asleep: boolean }> = {}) {
    const world = {
        expected: 2,
        engine: 2,
        asleep: false,
        ticks: 0 as number | null,
        wall: 0,
        ...overrides,
    };
    const probe: SettleProbe = {
        expectedDice: () => world.expected,
        engineDice: () => world.engine,
        allAsleep: () => world.asleep,
        ticks: () => world.ticks,
    };
    return { world, probe, now: () => world.wall };
}

/** Advance the world by one 60 Hz frame (two 120 Hz ticks) and poll. */
function frame(
    world: { ticks: number | null; wall: number },
    watch: ReturnType<typeof createSettleWatch>
) {
    if (world.ticks != null) world.ticks += 2;
    world.wall += 16;
    return watch.poll();
}

describe('SettleWatch', () => {
    it('settles after the dice sleep for the required consecutive polls', () => {
        const { world, probe, now } = makeWorld();
        const watch = createSettleWatch(probe, { now, stableChecks: 3 });
        watch.begin();
        expect(frame(world, watch).state).toBe('pending');
        world.asleep = true;
        expect(frame(world, watch).state).toBe('pending');
        expect(frame(world, watch).state).toBe('pending');
        const status = frame(world, watch);
        expect(status.state).toBe('settled');
        expect(watch.active).toBe(false);
    });

    it('ignores a stale "asleep" until the engine has ticked past the throw', () => {
        const { world, probe, now } = makeWorld({ asleep: true });
        const watch = createSettleWatch(probe, { now, stableChecks: 1, minTicksAfterBegin: 2 });
        watch.begin();
        // No ticks yet: the published flag still describes the previous roll.
        world.wall += 16;
        expect(watch.poll().state).toBe('pending');
        world.ticks = 2;
        expect(watch.poll().state).toBe('settled');
    });

    it('times out after the simulated budget, measured in engine ticks', () => {
        const { world, probe, now } = makeWorld();
        const watch = createSettleWatch(probe, { now, timeoutSimSeconds: 12, stallMs: 1e9 });
        watch.begin();
        let status = watch.poll();
        // 11.9 s of sim: still pending, however much wall time passes.
        world.ticks = Math.floor(11.9 * 120);
        world.wall = 600_000;
        status = watch.poll();
        expect(status.state).toBe('pending');
        world.ticks = 12 * 120;
        status = watch.poll();
        expect(status).toMatchObject({ state: 'timedOut', reason: 'simTimeout' });
        expect(status.simSeconds).toBeCloseTo(12);
        // Terminal: polling again does not reopen it.
        expect(watch.poll().state).toBe('timedOut');
    });

    it('times out as stalled when the engine stops ticking with dice awake', () => {
        const { world, probe, now } = makeWorld();
        const watch = createSettleWatch(probe, { now, stallMs: 5000 });
        watch.begin();
        world.wall = 4999;
        expect(watch.poll().state).toBe('pending');
        world.wall = 5000;
        expect(watch.poll()).toMatchObject({ state: 'timedOut', reason: 'stalled' });
    });

    it('does not count a paused (hidden) tab as a stall', () => {
        const { world, probe, now } = makeWorld();
        let paused = true;
        const watch = createSettleWatch(probe, { now, stallMs: 5000, isPaused: () => paused });
        watch.begin();
        world.wall = 60_000;
        expect(watch.poll().state).toBe('pending');
        paused = false;
        world.wall = 64_000;
        expect(watch.poll().state).toBe('pending');
        world.wall = 65_000;
        expect(watch.poll()).toMatchObject({ state: 'timedOut', reason: 'stalled' });
    });

    it('times out with missingBodies when the engine never registers the dice', () => {
        const { world, probe, now } = makeWorld({ engine: 0, asleep: true });
        const watch = createSettleWatch(probe, { now, missingBodiesMs: 3000, stallMs: 1e9 });
        watch.begin();
        for (let i = 0; i < 100; i++) {
            const status = frame(world, watch);
            if (status.state !== 'pending') {
                expect(status).toMatchObject({ state: 'timedOut', reason: 'missingBodies' });
                expect(world.wall).toBeGreaterThanOrEqual(3000);
                return;
            }
        }
        // 100 frames = 1.6 s: still waiting for the engine to catch up.
        world.wall = 3200;
        expect(watch.poll()).toMatchObject({ state: 'timedOut', reason: 'missingBodies' });
    });

    it('tolerates the engine briefly lagging the table (worker round trip)', () => {
        const { world, probe, now } = makeWorld({ engine: 0 });
        const watch = createSettleWatch(probe, { now, stableChecks: 1 });
        watch.begin();
        expect(frame(world, watch).state).toBe('pending');
        world.engine = 2;
        world.asleep = true;
        expect(frame(world, watch).state).toBe('settled');
    });

    it('settles immediately when there is nothing on the table', () => {
        const { world, probe, now } = makeWorld({ expected: 0, engine: 0 });
        const watch = createSettleWatch(probe, { now });
        watch.begin();
        expect(frame(world, watch).state).toBe('settled');
    });

    it('falls back to wall time when the engine reports no ticks', () => {
        const { world, probe, now } = makeWorld();
        world.ticks = null;
        const watch = createSettleWatch(probe, { now, timeoutSimSeconds: 2 });
        watch.begin();
        world.wall = 1999;
        expect(watch.poll().state).toBe('pending');
        world.wall = 2000;
        expect(watch.poll()).toMatchObject({ state: 'timedOut', reason: 'simTimeout' });
    });

    it('begin() rearms a finished watch for the next throw', () => {
        const { world, probe, now } = makeWorld({ asleep: true });
        const watch = createSettleWatch(probe, { now, stableChecks: 1 });
        watch.begin();
        expect(frame(world, watch).state).toBe('settled');
        world.asleep = false;
        watch.begin();
        expect(frame(world, watch).state).toBe('pending');
    });
});
