import { describe, expect, it } from 'vitest';
import { createSimDriver, FIXED_DT, MAX_CATCH_UP_TICKS } from 'dice-core/wasm/SimDriver';

/** MAX_TICKS_PER_STEP in dice_contacts.hpp. */
const ENGINE_MAX_TICKS_PER_STEP = 8;

/** The engine's accumulator (dice_engine_step.cpp) in miniature. */
function fakeEngine() {
    let accumulator = 0;
    let ticks = 0;
    return {
        step(dt: number) {
            accumulator += dt;
            let run = 0;
            while (accumulator + 1e-6 >= FIXED_DT) {
                if (run === ENGINE_MAX_TICKS_PER_STEP) {
                    accumulator = 0;
                    break;
                }
                accumulator -= FIXED_DT;
                ticks++;
                run++;
            }
        },
        getFixedTickCount: () => ticks,
    };
}

describe('SimDriver', () => {
    it('stepN runs exact ticks and reports the clock', () => {
        const driver = createSimDriver(fakeEngine());
        driver.stepN(412);
        expect(driver.stepIndex).toBe(412);
        expect(driver.simTime).toBeCloseTo(412 / 120, 12);
    });

    it('a 4x slower timer runs the same ticks per wall second', () => {
        const run = (intervalMs: number) => {
            const driver = createSimDriver(fakeEngine());
            driver.resume(0);
            for (let t = intervalMs; t <= 1000 + 1e-9; t += intervalMs) driver.tick(t);
            return driver.stepIndex;
        };
        expect(run(1000 / 120)).toBe(120);
        expect(run((4 * 1000) / 120)).toBe(120);
    });

    it('catches up at most MAX_CATCH_UP_TICKS per wakeup and drops the rest', () => {
        const driver = createSimDriver(fakeEngine());
        driver.resume(0);
        expect(driver.tick(1000)).toBe(MAX_CATCH_UP_TICKS);
        expect(driver.tick(1000 + 1000 / 120)).toBe(1);
    });

    it('replays a stall longer than the engine per-call cap in full', () => {
        // 200 ms = 24 ticks: more than the engine's 8-per-call drop, less than the catch-up cap.
        const driver = createSimDriver(fakeEngine());
        driver.resume(0);
        driver.tick(1000 / 120 / 2); // leave half a tick in the accumulator
        expect(driver.tick(1000 / 120 / 2 + 200)).toBe(24);
    });

    it('a jittery 4x-throttled timer with stalls loses no ticks over a second', () => {
        const driver = createSimDriver(fakeEngine());
        driver.resume(0);
        const gaps = [33.3, 33.3, 180, 33.3, 120, 33.3, 33.3, 240, 33.3];
        let t = 0;
        while (t < 1000) {
            t += gaps[driver.stepIndex % gaps.length]!;
            driver.tick(t);
        }
        expect(driver.stepIndex).toBe(Math.floor((t / 1000) * 120 + 1e-9));
    });

    it('resume re-anchors: time spent paused is not replayed', () => {
        const driver = createSimDriver(fakeEngine());
        driver.resume(0);
        driver.tick(50);
        const before = driver.stepIndex;
        driver.pause();
        expect(driver.tick(5000)).toBe(0);
        expect(driver.advance(1)).toBe(0);
        driver.resume(10_000);
        expect(driver.tick(10_000 + 1000 / 120)).toBe(1);
        expect(driver.stepIndex).toBe(before + 1);
    });

    it('the first tick only anchors the wall clock', () => {
        const driver = createSimDriver(fakeEngine());
        expect(driver.tick(123_456)).toBe(0);
        expect(driver.tick(123_456 + 2000 / 120)).toBe(2);
    });
});
