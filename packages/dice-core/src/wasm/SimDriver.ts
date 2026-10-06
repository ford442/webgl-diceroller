/**
 * The one physics clock, seen from JS.
 *
 * `DicePhysicsEngine::step(dt)` already *is* the clock: it banks `dt` in an
 * accumulator, runs fixed 1/120 s ticks and drops any backlog beyond
 * `MAX_TICKS_PER_STEP` (dice_contacts.hpp). This driver is only how every
 * caller feeds it — the physics worker (timer wakeups, by elapsed wall time),
 * the `?no-worker` main thread (frame deltas) and `rollHeadless()` (exact
 * ticks) — so none of them grows a second accumulator, and a late or
 * throttled timer catches up instead of playing the dice in slow motion.
 *
 * Simulation time is `stepIndex * FIXED_DT`: "step 412" names the same moment
 * in every process that replays a seed.
 */

/** Must match FIXED_DT in src/wasm/dice_physics/dice_contacts.hpp. */
export const FIXED_DT = 1 / 120;
/**
 * The most one wakeup catches up: 0.25 s. Longer gaps (a hidden tab, a
 * debugger pause) are dropped, not replayed. Measured worker stalls on a
 * loaded machine reach ~250 ms at both 1x and 4x timer rates; the engine's
 * own per-call cap (8 ticks) alone lost ~15% of wall time to them.
 */
export const MAX_CATCH_UP_TICKS = 30;
/**
 * `step()` drops its backlog once one call reaches MAX_TICKS_PER_STEP (8,
 * dice_contacts.hpp). Feeding at most 7 ticks per call keeps a carried-over
 * fraction of a tick from ever tripping that.
 */
const ENGINE_CHUNK_SECONDS = 7 * FIXED_DT;

export interface ClockedEngine {
    step(dt: number): void;
    getFixedTickCount(): number;
}

export interface SimClock {
    /** Fixed ticks the engine has run since init. */
    readonly stepIndex: number;
    /** `stepIndex * FIXED_DT`, in simulated seconds. */
    readonly simTime: number;
}

export interface SimDriver extends SimClock {
    readonly paused: boolean;
    /** Run the ticks `wallNowMs - previous call` is worth (capped). Returns ticks run. */
    tick(wallNowMs: number): number;
    /** Run the ticks an explicit wall delta is worth (capped). Returns ticks run. */
    advance(wallSeconds: number): number;
    /** Run exactly `n` ticks, regardless of pause (headless, tests). */
    stepN(n: number): void;
    /** Stop `tick` / `advance` from stepping. */
    pause(): void;
    /** Re-anchor the wall clock at `wallNowMs`: time spent paused or parked is dropped. */
    resume(wallNowMs: number): void;
}

const MAX_CATCH_UP_SECONDS = MAX_CATCH_UP_TICKS * FIXED_DT;

export function createSimDriver(engine: ClockedEngine): SimDriver {
    let paused = false;
    let lastWallMs: number | null = null;

    const run = (seconds: number): number => {
        if (paused || !(seconds > 0)) return 0;
        const before = engine.getFixedTickCount();
        let remaining = Math.min(seconds, MAX_CATCH_UP_SECONDS);
        while (remaining > 0) {
            const chunk = Math.min(remaining, ENGINE_CHUNK_SECONDS);
            engine.step(chunk);
            remaining -= chunk;
        }
        return engine.getFixedTickCount() - before;
    };

    return {
        get paused() {
            return paused;
        },
        get stepIndex() {
            return engine.getFixedTickCount();
        },
        get simTime() {
            return engine.getFixedTickCount() * FIXED_DT;
        },
        tick(wallNowMs) {
            const last = lastWallMs ?? wallNowMs;
            lastWallMs = wallNowMs;
            return run((wallNowMs - last) / 1000);
        },
        advance: run,
        stepN(n) {
            for (let i = 0; i < n; i++) engine.step(FIXED_DT);
        },
        pause() {
            paused = true;
        },
        resume(wallNowMs) {
            paused = false;
            lastWallMs = wallNowMs;
        },
    };
}
