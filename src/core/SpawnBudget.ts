/**
 * Spawn budget — pay for boot work a slice per frame instead of all at once.
 *
 * `spawnTier` used to run every prop of a tier back to back: its factories are
 * synchronous, so each `await` between props resolved as a microtask and the
 * main thread never saw the event loop (no paint, no `load`, no input) until
 * the whole chain finished. A cached second visit has no network waits to
 * break the chain, so it ran as one task (#365).
 *
 * `checkpoint()` goes between props. While the current slice is inside its
 * budget it returns at once; once the budget is spent it waits for the frame
 * scheduler's next frame (`FrameScheduler.nextFrame()`, its own clock, so the
 * continuation lands in a rendering opportunity, not a `setTimeout` clamp) and
 * starts a new slice. The two escape hatches keep a boot from stalling:
 *
 *   - hidden tab: rAF is paused, nobody is looking, so don't wait — run on;
 *   - frame never comes (loop stopped): a watchdog timer bounds the wait.
 *
 * A budget of 0 (`?spawn-budget=0`) never yields: the old behaviour, kept as an
 * A/B switch for measurement.
 */
import type { BootTrace } from './BootTrace';
import type { FrameScheduler } from './FrameScheduler';

export interface SpawnBudgetOptions {
    scheduler: Pick<FrameScheduler, 'nextFrame'>;
    /** Milliseconds of work per frame slice; `<= 0` never yields. */
    budgetMs: number;
    now?: () => number;
    isHidden?: () => boolean;
    /** Longest to wait for a frame that never comes (default 1000 ms). */
    watchdogMs?: number;
    trace?: Pick<BootTrace, 'count'>;
    /** Names the counter (`yields:<label>`) this budget's yields are tallied under. */
    label?: string;
}

export interface SpawnBudgetStats {
    yields: number;
    /** Yields that ended on the watchdog instead of a frame. */
    watchdogYields: number;
    /** Checkpoints that skipped a yield because the tab was hidden. */
    hiddenSkips: number;
    /** Longest slice (ms of work between two yields), measured when it ended. */
    longestSliceMs: number;
}

export interface SpawnBudget {
    readonly budgetMs: number;
    /** Change the per-slice budget (and counter label) and start a fresh slice. */
    configure(budgetMs: number, label?: string): void;
    beginSlice(): void;
    /** Call between units of work. Returns a promise only when it yields. */
    checkpoint(): Promise<void> | void;
    stats(): SpawnBudgetStats;
}

/** Tier budgets in ms/frame. Tier 0 is bigger so `ready` is not held up by yields. */
export interface SpawnBudgets {
    tier0: number;
    tier1: number;
    decor: number;
}

export const DEFAULT_SPAWN_BUDGETS: Readonly<SpawnBudgets> = {
    tier0: 16,
    tier1: 6,
    decor: 6,
};

/**
 * `?spawn-budget=<ms>` sets every tier to one value (`0` = never yield, the old
 * behaviour); absent or unparsable, the defaults apply.
 */
export function resolveSpawnBudgets(searchParams: URLSearchParams): SpawnBudgets {
    const raw = searchParams.get('spawn-budget');
    if (raw === null || raw.trim() === '') return { ...DEFAULT_SPAWN_BUDGETS };
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { ...DEFAULT_SPAWN_BUDGETS };
    return { tier0: value, tier1: value, decor: value };
}

export function createSpawnBudget(options: SpawnBudgetOptions): SpawnBudget {
    const now = options.now ?? (() => performance.now());
    const isHidden =
        options.isHidden ?? (() => typeof document !== 'undefined' && document.hidden === true);
    const watchdogMs = options.watchdogMs ?? 1000;
    let budgetMs = options.budgetMs;
    let label = options.label ?? 'spawn';
    let sliceStart = now();
    const counts: SpawnBudgetStats = {
        yields: 0,
        watchdogYields: 0,
        hiddenSkips: 0,
        longestSliceMs: 0,
    };

    async function yieldToFrame(sliceMs: number): Promise<void> {
        counts.yields += 1;
        counts.longestSliceMs = Math.max(counts.longestSliceMs, sliceMs);
        options.trace?.count(`yields:${label}`);

        let timer: ReturnType<typeof setTimeout> | undefined;
        const watchdog = new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(true), watchdogMs);
        });
        const timedOut = await Promise.race([
            options.scheduler.nextFrame().then(() => false),
            watchdog,
        ]);
        clearTimeout(timer);
        if (timedOut) {
            counts.watchdogYields += 1;
            options.trace?.count('watchdogYields');
        }
        sliceStart = now();
    }

    return {
        get budgetMs() {
            return budgetMs;
        },
        configure(nextBudgetMs, nextLabel) {
            budgetMs = nextBudgetMs;
            if (nextLabel !== undefined) label = nextLabel;
            sliceStart = now();
        },
        beginSlice() {
            sliceStart = now();
        },
        checkpoint() {
            if (!(budgetMs > 0)) return;
            const elapsed = now() - sliceStart;
            if (elapsed < budgetMs) return;
            if (isHidden()) {
                counts.hiddenSkips += 1;
                counts.longestSliceMs = Math.max(counts.longestSliceMs, elapsed);
                sliceStart = now();
                return;
            }
            return yieldToFrame(elapsed);
        },
        stats: () => ({ ...counts }),
    };
}
