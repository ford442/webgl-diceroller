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
 *   catchUp(now)   the main-thread (?no-worker) driver: owes the wall time
 *                  since the previous call and pays it in single ticks until
 *                  it is paid, a wall budget (a share of the frame) runs out
 *                  or a tick cap is hit.
 *                  What it cannot pay this frame it carries to the next
 *                  (bounded), and `behind` says so — a slow frame runs the
 *                  roll slower instead of dropping simulated time.
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

/** Least wall budget one `catchUp()` call may spend stepping. */
export const SIM_CATCH_UP_BUDGET_MS = 8;
/**
 * Share of the wall time since the previous call that `catchUp()` may spend
 * stepping, when that is more than SIM_CATCH_UP_BUDGET_MS. At 60 fps the
 * floor applies (8 ms of a 16 ms frame); on a software-rendered frame of
 * several seconds a fixed 8 ms paid ~25 ticks, so a 4 s roll took minutes of
 * wall time. Proportional, the physics adds at most a third to a frame
 * (P = 0.25·(R + P)) and cannot spiral.
 */
export const SIM_CATCH_UP_BUDGET_FRACTION = 0.25;
/** Default cap on ticks one `catchUp()` call runs (four simulated seconds). */
export const SIM_CATCH_UP_MAX_TICKS = 480;
/**
 * Default cap on the owed time `catchUp()` carries between calls. Bounds the
 * fast-forward after a long gap (a hidden tab stops the render loop).
 */
export const SIM_CATCH_UP_MAX_BACKLOG_SECONDS = 4;

export interface CatchUpOptions {
    /**
     * Wall ms this call may spend stepping (at least one tick always runs).
     * Default: the larger of SIM_CATCH_UP_BUDGET_MS and
     * SIM_CATCH_UP_BUDGET_FRACTION of the wall time since the previous call.
     */
    budgetMs?: number;
    /** Ticks this call may run. */
    maxTicks?: number;
    /** Owed simulated seconds carried past this call; the excess is dropped. */
    maxBacklogSeconds?: number;
}

export interface CatchUpResult {
    /** Fixed ticks the engine ran. */
    ticks: number;
    /** At least one tick of owed time is still unpaid. */
    behind: boolean;
    /** Owed simulated seconds carried into the next call. */
    backlogSeconds: number;
}

export interface SimClockOptions {
    /** Millisecond wall clock; defaults to `performance.now()`. */
    now?: () => number;
    /** Cap on ticks per advance; never above the engine's own cap. */
    maxCatchUpTicks?: number;
}

// Wall time paces how many fixed ticks to run; it never enters a tick.
const defaultNow = (): number =>
    // eslint-disable-next-line no-restricted-properties
    typeof performance !== 'undefined' ? performance.now() : Date.now();

export class SimClock {
    readonly fixedDt = SIM_FIXED_DT;
    readonly maxCatchUpTicks: number;
    private readonly engine: ClockedEngine;
    private readonly now: () => number;
    private lastMs: number | null = null;
    private _paused = false;
    private backlog = 0;
    private _behind = false;

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

    /** The last `catchUp()` left owed time unpaid (the simulation is running slow). */
    get behind(): boolean {
        return this._behind;
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

    /**
     * Owe the wall time since the previous call (the first call after
     * construction, `resume()` or `skip()` only sets the baseline) and pay it
     * one fixed tick at a time — the same ticks `advance` would run, so a
     * seeded roll is unchanged — until it is paid, `budgetMs` of wall time is
     * spent or `maxTicks` ran. Unpaid time carries to the next call, up to
     * `maxBacklogSeconds`.
     */
    catchUp(nowMs: number = this.now(), options: CatchUpOptions = {}): CatchUpResult {
        if (this._paused) return { ticks: 0, behind: false, backlogSeconds: 0 };
        const maxTicks = Math.max(1, Math.floor(options.maxTicks ?? SIM_CATCH_UP_MAX_TICKS));
        const maxBacklog = options.maxBacklogSeconds ?? SIM_CATCH_UP_MAX_BACKLOG_SECONDS;
        const last = this.lastMs;
        this.lastMs = nowMs;
        const elapsed = last === null ? 0 : (nowMs - last) / 1000;
        const budgetMs =
            options.budgetMs ??
            Math.max(
                SIM_CATCH_UP_BUDGET_MS,
                elapsed > 0 && Number.isFinite(elapsed)
                    ? elapsed * 1000 * SIM_CATCH_UP_BUDGET_FRACTION
                    : 0
            );
        if (elapsed > 0 && Number.isFinite(elapsed)) this.backlog += elapsed;
        this.backlog = Math.min(this.backlog, Math.max(0, maxBacklog));

        // Same tolerance as the engine's FIXED_DT_EPSILON: 1/60 s owed is two
        // ticks, not one and a rounding remainder.
        const due = () => this.backlog + 1e-6 >= this.fixedDt;
        const started = this.now();
        const before = this.stepIndex;
        let ran = 0;
        while (due() && ran < maxTicks) {
            if (ran > 0 && this.now() - started >= budgetMs) break;
            this.engine.step(this.fixedDt);
            this.backlog -= this.fixedDt;
            ran += 1;
        }
        if (this.backlog < 0) this.backlog = 0;
        this._behind = due();
        return {
            ticks: this.stepIndex - before,
            behind: this._behind,
            backlogSeconds: this.backlog,
        };
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
        this.dropBacklog();
    }

    /** Restart from `nowMs` without fast-forwarding over the paused span. */
    resume(nowMs: number = this.now()): void {
        this._paused = false;
        this.lastMs = nowMs;
        this.dropBacklog();
    }

    /** Drop elapsed wall time without stepping (nothing to simulate). */
    skip(nowMs: number = this.now()): void {
        if (!this._paused) this.lastMs = nowMs;
        this.dropBacklog();
    }

    private dropBacklog(): void {
        this.backlog = 0;
        this._behind = false;
    }
}
