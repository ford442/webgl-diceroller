import { describe, expect, it } from 'vitest';
import { createInProcessPhysicsSession, defaultHeadlessAssets } from 'dice-core';
import {
    SIM_CATCH_UP_BUDGET_FRACTION,
    SIM_CATCH_UP_MAX_BACKLOG_SECONDS,
    SIM_CATCH_UP_MAX_TICKS,
    SIM_FIXED_DT,
    SIM_MAX_CATCH_UP_TICKS,
    SimClock,
    type ClockedEngine,
} from 'dice-core/wasm/SimClock';
import { describeWasm } from './wasmGate.js';

/** The engine's own clock contract (dice_engine_step.cpp), in JS. */
function fakeEngine(): ClockedEngine & { ticks: number } {
    let accumulator = 0;
    const engine = {
        ticks: 0,
        step(dt: number) {
            if (!(dt > 0)) return;
            accumulator += dt;
            let run = 0;
            while (accumulator + 1e-6 >= SIM_FIXED_DT) {
                if (run === SIM_MAX_CATCH_UP_TICKS) {
                    accumulator = 0;
                    break;
                }
                engine.ticks += 1;
                accumulator -= SIM_FIXED_DT;
                run += 1;
            }
            if (accumulator < 0) accumulator = 0;
        },
        getFixedTickCount: () => engine.ticks,
    };
    return engine;
}

/** Drive `clock.advance` from a timer firing every `intervalMs` for `ms`. */
function runTimer(clock: SimClock, intervalMs: number, ms: number): void {
    clock.resume(0);
    for (let t = intervalMs; t <= ms + 1e-9; t += intervalMs) clock.advance(t);
}

/** A wall clock that advances `costMs` every time a tick runs. */
function costlyEngine(costMs: number) {
    const engine = fakeEngine();
    const clock = { ms: 0 };
    const step = engine.step;
    engine.step = (dt: number) => {
        const before = engine.ticks;
        step(dt);
        clock.ms += (engine.ticks - before) * costMs;
    };
    return { engine, clock };
}

describe('SimClock.catchUp (main-thread driver)', () => {
    it('pays a slow frame in full when the ticks are cheap', () => {
        const engine = fakeEngine();
        const clock = new SimClock(engine, { now: () => 0 });
        clock.catchUp(0);
        // A 250 ms frame (SwiftShader): advanceBy() would have run 8 ticks.
        const r = clock.catchUp(250);
        expect(r.ticks).toBe(30);
        expect(r.behind).toBe(false);
        expect(clock.behind).toBe(false);
    });

    it('stops at the wall budget, carries the rest and reports behind', () => {
        const { engine, clock: wall } = costlyEngine(1);
        const clock = new SimClock(engine, { now: () => wall.ms });
        clock.catchUp(0, { budgetMs: 8 });
        const first = clock.catchUp(500, { budgetMs: 8 });
        expect(first.ticks).toBe(8);
        expect(first.behind).toBe(true);
        expect(first.backlogSeconds).toBeCloseTo(0.5 - 8 * SIM_FIXED_DT, 9);
        // Later frames with no new wall time pay the carried backlog off.
        let ticks = first.ticks;
        let r = first;
        for (let i = 0; i < 20 && r.behind; i++) {
            r = clock.catchUp(500, { budgetMs: 8 });
            ticks += r.ticks;
        }
        expect(r.behind).toBe(false);
        expect(ticks).toBe(60);
    });

    it('a slow frame earns a proportional budget, not a fixed 8 ms', () => {
        // 1 ms per tick, 2 s frames (SwiftShader): 8 ms would pay 8 ticks a
        // frame; a quarter of the frame pays all 240.
        const { engine, clock: wall } = costlyEngine(1);
        const clock = new SimClock(engine, { now: () => wall.ms });
        clock.catchUp(0);
        wall.ms = 2000;
        const r = clock.catchUp(2000);
        expect(r.ticks).toBe(240);
        expect(r.behind).toBe(false);
    });

    it('a frame whose share cannot pay the ticks carries the rest', () => {
        // 5 ms per tick, a 400 ms frame: 48 ticks owed, 100 ms budget → 20.
        const { engine, clock: wall } = costlyEngine(5);
        const clock = new SimClock(engine, { now: () => wall.ms });
        clock.catchUp(0);
        const r = clock.catchUp(400);
        expect(r.ticks).toBe((400 * SIM_CATCH_UP_BUDGET_FRACTION) / 5);
        expect(r.behind).toBe(true);
        expect(r.backlogSeconds).toBeCloseTo(0.4 - r.ticks * SIM_FIXED_DT, 9);
    });

    it('caps the ticks per call and the carried backlog', () => {
        const engine = fakeEngine();
        const clock = new SimClock(engine, { now: () => 0 });
        clock.catchUp(0);
        const r = clock.catchUp(10_000);
        expect(r.ticks).toBe(SIM_CATCH_UP_MAX_TICKS);
        expect(r.ticks * SIM_FIXED_DT).toBeCloseTo(SIM_CATCH_UP_MAX_BACKLOG_SECONDS, 9);
        expect(r.behind).toBe(false);
        expect(r.backlogSeconds).toBeLessThan(SIM_FIXED_DT);
        const r2 = clock.catchUp(20_000, { maxBacklogSeconds: 0.5, maxTicks: 10 });
        expect(r2.ticks).toBe(10);
        expect(r2.backlogSeconds).toBeCloseTo(0.5 - 10 * SIM_FIXED_DT, 9);
    });

    it('runs the same ticks as advance() at 60 fps', () => {
        const a = new SimClock(fakeEngine());
        const b = new SimClock(fakeEngine(), { now: () => 0 });
        a.resume(0);
        b.catchUp(0);
        for (let f = 1; f <= 120; f++) {
            a.advance((f * 1000) / 60);
            b.catchUp((f * 1000) / 60);
        }
        expect(b.stepIndex).toBe(a.stepIndex);
        expect(b.stepIndex).toBe(240);
    });

    it('skip() drops the backlog: parked time is never caught up on', () => {
        const { engine, clock: wall } = costlyEngine(1);
        const clock = new SimClock(engine, { now: () => wall.ms });
        clock.catchUp(0, { budgetMs: 2 });
        expect(clock.catchUp(1000, { budgetMs: 2 }).behind).toBe(true);
        clock.skip(5000);
        expect(clock.behind).toBe(false);
        expect(clock.catchUp(5000).ticks).toBe(0);
    });
});

describe('SimClock', () => {
    it('first advance sets the baseline; later ones step the elapsed time', () => {
        const engine = fakeEngine();
        const clock = new SimClock(engine);
        expect(clock.advance(1000)).toBe(0);
        expect(clock.advance(1000 + 1000 / 120)).toBe(1);
        expect(clock.advance(1000 + 1000 / 30)).toBe(3);
        expect(clock.stepIndex).toBe(4);
        expect(clock.simTime).toBeCloseTo(4 / 120, 12);
    });

    it('a throttled timer catches up: sim speed does not depend on the wakeup rate', () => {
        const normal = new SimClock(fakeEngine());
        const throttled = new SimClock(fakeEngine());
        runTimer(normal, 1000 / 120, 2000);
        // 4× slower wakeups (33 ms) — the old worker ran 4× slower dice here.
        runTimer(throttled, (4 * 1000) / 120, 2000);
        expect(normal.stepIndex).toBe(240);
        expect(Math.abs(throttled.stepIndex - normal.stepIndex)).toBeLessThanOrEqual(1);
    });

    it('caps catch-up at the engine limit instead of spiralling', () => {
        const clock = new SimClock(fakeEngine());
        clock.resume(0);
        expect(clock.advance(5000)).toBe(SIM_MAX_CATCH_UP_TICKS);
    });

    it('pause/resume skips the parked span instead of fast-forwarding', () => {
        const clock = new SimClock(fakeEngine());
        clock.resume(0);
        clock.advance(100);
        const before = clock.stepIndex;
        clock.pause();
        expect(clock.advance(10_000)).toBe(0);
        clock.resume(60_000);
        expect(clock.advance(60_000 + 1000 / 120)).toBe(1);
        expect(clock.stepIndex).toBe(before + 1);
    });

    it('skip() drops elapsed time when there is nothing to simulate', () => {
        const clock = new SimClock(fakeEngine());
        clock.resume(0);
        clock.skip(500);
        expect(clock.advance(500 + 1000 / 60)).toBe(2);
    });

    it('stepN runs exactly n ticks; advanceBy honours the cap', () => {
        const clock = new SimClock(fakeEngine(), { maxCatchUpTicks: 3 });
        expect(clock.stepN(17)).toBe(17);
        expect(clock.advanceBy(1)).toBe(3);
        expect(clock.advanceBy(-1)).toBe(0);
        expect(clock.advanceBy(Number.NaN)).toBe(0);
    });
});

describeWasm('SimClock on the WASM engine', () => {
    it('the engine runs one fixed tick per SIM_FIXED_DT and banks the remainder', async () => {
        const session = await createInProcessPhysicsSession({
            assets: defaultHeadlessAssets(),
            requireHulls: true,
            quiet: true,
        });
        expect(session.available).toBe(true);
        const { engine } = session;
        engine.init(-15, -2.75, 18, 18);
        engine.addDie(6, 0, 4, 0);
        const clock = new SimClock(engine);
        expect(clock.stepN(10)).toBe(10);
        // 1.5 ticks banks half a tick; the next half completes it.
        expect(clock.advanceBy(1.5 * SIM_FIXED_DT)).toBe(1);
        expect(clock.advanceBy(0.5 * SIM_FIXED_DT)).toBe(1);
        expect(clock.advanceBy(1)).toBe(SIM_MAX_CATCH_UP_TICKS);
        expect(clock.stepIndex).toBe(12 + SIM_MAX_CATCH_UP_TICKS);
    });
});
