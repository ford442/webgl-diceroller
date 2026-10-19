/**
 * SimClock — the one simulation clock for every place that drives the engine:
 * the physics worker (timer wakeups), the main-thread bridge (render frames)
 * and `rollHeadless()` (a tight loop).
 *
 * The engine owns the integration quantum (FIXED_DT / MAX_TICKS_PER_STEP in
 * src/wasm/dice_physics/dice_contacts.hpp): `step(dt)` banks `dt` and runs as
 * many fixed 1/120 s ticks as it covers, at most eight per call, dropping any
 * backlog beyond that. This class decides *how much* time to hand it:
 *
 *   advance(now)   wall-clock driven — the time since the previous advance,
 *                  so a late or throttled timer catches up (up to the cap)
 *                  instead of playing the dice in slow motion.
 *   advanceBy(s)   caller-measured time (a render frame's deltaTime).
 *   stepN(n)       exactly n ticks, for headless loops and tests.
 *   pause/resume   resume restarts the wall-clock baseline: time spent parked
 *                  or hidden is skipped, never fast-forwarded.
 *
 * `stepIndex` is the engine's fixed tick counter — the same value the worker
 * publishes in the SAB header (H_TICKS) — so render interpolation, settle
 * timeouts and multiplayer can name "tick 412" instead of "now".
 */

/** Engine fixed tick (must match FIXED_DT in dice_contacts.hpp). */
export const SIM_FIXED_DT = 1 / 120;
/** Ticks one `step()` call may run (must match MAX_TICKS_PER_STEP). */
export const SIM_MAX_CATCH_UP_TICKS = 8;

export interface ClockedEngine {
    step(dt: number): void;
    /** Present on every WASM build; absent only on hand-rolled test doubles. */
    getFixedTickCount?(): number;
}

export interface SimClockOptions {
    /** Millisecond wall clock; defaults to `performance.now()`. */
    now?: () => number;
    /** Cap on ticks per advance; never above the engine's own cap. */
    maxCatchUpTicks?: number;
}

const defaultNow = (): number =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

export class SimClock {
    readonly fixedDt = SIM_FIXED_DT;
    readonly maxCatchUpTicks: number;
    private readonly engine: ClockedEngine;
    private readonly now: () => number;
    private lastMs: number | null = null;
    private _paused = false;

    constructor(engine: ClockedEngine, options: SimClockOptions = {}) {
        this.engine = engine;
        this.now = options.now ?? defaultNow;
        this.maxCatchUpTicks = Math.max(
            1,
            Math.min(SIM_MAX_CATCH_UP_TICKS, Math.floor(options.maxCatchUpTicks ?? Infinity))
        );
    }

    /** Fixed ticks the engine has run since init/reset. */
    get stepIndex(): number {
        return this.engine.getFixedTickCount?.() ?? 0;
    }

    /** Simulated seconds since init/reset (`stepIndex * fixedDt`). */
    get simTime(): number {
        return this.stepIndex * this.fixedDt;
    }

    get paused(): boolean {
        return this._paused;
    }

    /**
     * Hand the engine the wall time elapsed since the previous call (the first
     * call after construction or `resume()` only sets the baseline). Returns
     * the number of ticks the engine ran.
     */
    advance(nowMs: number = this.now()): number {
        if (this._paused) return 0;
        const last = this.lastMs;
        this.lastMs = nowMs;
        if (last === null) return 0;
        return this.advanceBy((nowMs - last) / 1000);
    }

    /** Hand the engine `seconds` of simulated time, capped at the catch-up limit. */
    advanceBy(seconds: number): number {
        if (this._paused || !(seconds > 0) || !Number.isFinite(seconds)) return 0;
        const capped = Math.min(seconds, this.maxCatchUpTicks * this.fixedDt);
        const before = this.stepIndex;
        this.engine.step(capped);
        return this.stepIndex - before;
    }

    /** Run exactly `n` fixed ticks (ignores pause; it is an explicit request). */
    stepN(n: number): number {
        const before = this.stepIndex;
        for (let i = 0; i < n; i++) this.engine.step(this.fixedDt);
        return this.stepIndex - before;
    }

    /** Stop handing out time; `advance()` returns 0 until `resume()`. */
    pause(): void {
        this._paused = true;
        this.lastMs = null;
    }

    /** Restart from `nowMs` without fast-forwarding over the paused span. */
    resume(nowMs: number = this.now()): void {
        this._paused = false;
        this.lastMs = nowMs;
    }

    /** Drop elapsed wall time without stepping (nothing to simulate). */
    skip(nowMs: number = this.now()): void {
        if (!this._paused) this.lastMs = nowMs;
    }
}
