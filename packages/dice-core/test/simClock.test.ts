import { describe, expect, it } from 'vitest';
import { createInProcessPhysicsSession, defaultHeadlessAssets } from 'dice-core';
import {
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
