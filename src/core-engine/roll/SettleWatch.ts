/**
 * A roll that always ends: `spawned → thrown → settled | timedOut`.
 *
 * Every roll path (throw, notation, tower, cup, remote) waits for the dice to
 * sleep before it reads faces. Before #341 that wait had no exit — a die that
 * never slept, or a table whose bodies never reached the engine, left the
 * camera in WAITING_FOR_STOP and the notation session "in progress" forever.
 *
 * `createSettleWatch` is the one place that decides when a wait is over:
 *   • settled      — the engine reports every die asleep for `stableChecks`
 *                    consecutive polls, after the engine has ticked past the
 *                    throw (a stale "settled" from the previous roll is not
 *                    an answer).
 *   • timedOut     — `simTimeout`: `timeoutSimSeconds` of *simulated* time
 *                    passed (fixed ticks, so a slow CPU or a throttled tab does
 *                    not cut a roll short); `stalled`: the engine stopped
 *                    ticking while dice were awake; `missingBodies`: the table
 *                    has dice the engine never registered.
 *
 * Pure and DOM-free: the probe and the clock are injected.
 */

export type SettleState = 'pending' | 'settled' | 'timedOut';
export type SettleTimeoutReason = 'simTimeout' | 'stalled' | 'missingBodies';

export interface SettleProbe {
    /** Dice on the table that should have engine bodies. */
    expectedDice(): number;
    /** Die bodies the engine reports (published count on the worker). */
    engineDice(): number;
    /** Every non-kinematic die body is asleep. */
    allAsleep(): boolean;
    /** Fixed engine ticks since boot, or null when unknown (stub engine). */
    ticks(): number | null;
}

export interface SettleWatchOptions {
    /** Simulated seconds after which a roll is read as it lies. Default 12. */
    timeoutSimSeconds?: number;
    /** Engine fixed-tick rate (FIXED_DT in dice_contacts.hpp). Default 120. */
    tickHz?: number;
    /** Wall ms with no tick progress (dice awake) before giving up. Default 5000. */
    stallMs?: number;
    /** Wall ms the engine may lag the table's die count. Default 3000. */
    missingBodiesMs?: number;
    /** Consecutive asleep polls required. Default 3. */
    stableChecks?: number;
    /** Ticks the engine must run after begin() before "asleep" counts. Default 2. */
    minTicksAfterBegin?: number;
    now?: () => number;
    /** While true (e.g. a hidden tab), stall detection does not advance. */
    isPaused?: () => boolean;
}

export interface SettleStatus {
    state: SettleState;
    reason?: SettleTimeoutReason;
    /** Simulated seconds since begin(), when the engine reports ticks. */
    simSeconds: number | null;
}

export interface SettleWatch {
    begin(): void;
    poll(): SettleStatus;
    readonly active: boolean;
}

export const DEFAULT_SETTLE_TIMEOUT_SIM_SECONDS = 12;

export function createSettleWatch(
    probe: SettleProbe,
    options: SettleWatchOptions = {}
): SettleWatch {
    const timeoutSim = options.timeoutSimSeconds ?? DEFAULT_SETTLE_TIMEOUT_SIM_SECONDS;
    const tickHz = options.tickHz ?? 120;
    const stallMs = options.stallMs ?? 5000;
    const missingBodiesMs = options.missingBodiesMs ?? 3000;
    const stableChecks = Math.max(1, options.stableChecks ?? 3);
    const minTicksAfterBegin = options.minTicksAfterBegin ?? 2;
    const now = options.now ?? (() => Date.now());
    const isPaused = options.isPaused ?? (() => false);

    let active = false;
    let startTicks: number | null = null;
    let startWall = 0;
    let lastTicks: number | null = null;
    let lastProgressWall = 0;
    let missingSince: number | null = null;
    let stable = 0;
    let finished: SettleStatus | null = null;

    function finish(status: SettleStatus): SettleStatus {
        finished = status;
        active = false;
        return status;
    }

    return {
        get active() {
            return active;
        },
        begin() {
            active = true;
            finished = null;
            startTicks = probe.ticks();
            lastTicks = startTicks;
            startWall = now();
            lastProgressWall = startWall;
            missingSince = null;
            stable = 0;
        },
        poll(): SettleStatus {
            if (finished) return finished;
            if (!active) this.begin();

            const t = now();
            const ticks = probe.ticks();
            const simSeconds =
                ticks != null && startTicks != null ? (ticks - startTicks) / tickHz : null;

            const expected = probe.expectedDice();
            if (expected <= 0) return finish({ state: 'settled', simSeconds });

            if (ticks !== lastTicks || isPaused()) {
                lastTicks = ticks;
                lastProgressWall = t;
            }

            if (probe.engineDice() < expected) {
                stable = 0;
                missingSince ??= t;
                if (t - missingSince >= missingBodiesMs) {
                    return finish({ state: 'timedOut', reason: 'missingBodies', simSeconds });
                }
                return { state: 'pending', simSeconds };
            }
            missingSince = null;

            const tickedPastBegin =
                ticks == null || startTicks == null || ticks - startTicks >= minTicksAfterBegin;
            if (tickedPastBegin && probe.allAsleep()) {
                stable += 1;
                if (stable >= stableChecks) return finish({ state: 'settled', simSeconds });
                return { state: 'pending', simSeconds };
            }
            stable = 0;

            if (simSeconds != null) {
                if (simSeconds >= timeoutSim) {
                    return finish({ state: 'timedOut', reason: 'simTimeout', simSeconds });
                }
            } else if (t - startWall >= timeoutSim * 1000) {
                return finish({ state: 'timedOut', reason: 'simTimeout', simSeconds });
            }
            if (ticks != null && t - lastProgressWall >= stallMs) {
                return finish({ state: 'timedOut', reason: 'stalled', simSeconds });
            }
            return { state: 'pending', simSeconds };
        },
    };
}
