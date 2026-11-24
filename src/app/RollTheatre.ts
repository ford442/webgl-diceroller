/**
 * Roll theatre: seek, slow-play and "live" for the roll that just happened.
 *
 * The replay is the throw, not its pixels: `(seed, dice, kind)` from
 * ThrowRecord plus the world it started from. Seeking to tick N rewinds the
 * table to that world, applies the same seeded throw and steps exactly N fixed
 * ticks on the engine that runs the table (no second engine, no second
 * integrator). Playback is more fixed ticks on top of the last seek. "Live"
 * puts the table back exactly as it was when the theatre took it.
 *
 * Only a finished roll can be scrubbed: while a throw is in flight the live
 * step is the only writer, and a seek is refused.
 */

import { AppEvent } from '../core/AppEvents.js';
import {
    getWasmEngine,
    isReplayActive,
    isWasmAvailable,
    replayEnter,
    replayExit,
    replaySeek,
    replayStep,
} from '../wasm/PhysicsBridge.js';
import {
    getLastThrowRecord,
    throwRecordMatchesTable,
    type ThrowRecord,
} from '../dice/ThrowRecord.js';
import type { ReplayBase, ReplayFrame } from 'dice-core/wasm/replayThrow';
import type { AppEvents, TheatreRefusal, TheatreState } from '../types/app';
import {
    CRIT_REPLAY_RATE,
    advancePlayback,
    clampTick,
    critReplayStartTick,
    findCritDice,
    type CritDie,
    type SettledDieRow,
} from './rollTheatreModel.js';

// The state shapes live in types/app.d.ts (AppContextTheatre uses them); this
// module re-exports them so the dependency runs one way (no import cycle).
export type { TheatreRefusal, TheatreState };

interface SettledRoll {
    record: ThrowRecord;
    base: ReplayBase;
    endTick: number;
    results: SettledDieRow[];
    slots: number[] | null;
}

type Listener = (state: TheatreState) => void;

export interface RollTheatre {
    getState(): TheatreState;
    subscribe(listener: Listener): () => void;
    /** Pose the dice at `tick` (clamped to the timeline). Null and a reason when refused. */
    seek(tick: number): Promise<ReplayFrame | null>;
    /** Play forward from the current tick (or `from`) at `rate`, stopping at the settle. */
    play(rate?: number, options?: { from?: number }): Promise<boolean>;
    pause(): void;
    /** Return the table to the settled pose and hand it back to the live step. */
    live(): Promise<void>;
    /**
     * Crit cam: when the settled roll has a natural max or min, seek to 1.5 s
     * before the settle and play it at quarter speed. Returns the die to watch
     * and a promise that resolves when the replay ends (or is skipped), or
     * null when there is nothing to replay.
     */
    beginCrit(): { crit: CritDie; done: Promise<void> } | null;
    /** Stop a crit replay (and any playback) and go live. */
    skip(): Promise<void>;
    /** Per-frame: advance playback. */
    update(deltaSeconds: number): void;
    /** Why a seek would be refused right now, or null. */
    refusal(): TheatreRefusal | null;
}

export function createRollTheatre({
    appEvents,
    isRolling = () => false,
}: {
    appEvents: AppEvents;
    /** The roll lifecycle's own view (`getRollState().phase === 'rolling'`). */
    isRolling?: () => boolean;
}): RollTheatre {
    let rolling = false;
    let settled: SettledRoll | null = null;
    /** Serial of the roll `settled` describes, while its base is still resolving. */
    let pendingSerial = 0;
    let active = false;
    let playing = false;
    let rate = 1;
    let tick = 0;
    let carry = 0;
    let inFlight = false;
    let crit: { resolve: () => void } | null = null;
    let lastReason: TheatreRefusal | null = 'no-roll';
    const listeners = new Set<Listener>();

    function refusal(): TheatreRefusal | null {
        if (!isWasmAvailable()) return 'no-wasm';
        if (rolling || isRolling()) return 'rolling';
        if (!settled) return lastReason ?? 'no-roll';
        if (!throwRecordMatchesTable(settled.record)) return 'table-changed';
        return null;
    }

    function getState(): TheatreState {
        const reason = refusal();
        return {
            available: reason === null,
            active,
            playing,
            rate,
            tick,
            endTick: settled?.endTick ?? 0,
            reason,
            crit: crit !== null,
        };
    }

    function notify(): void {
        const state = getState();
        for (const listener of listeners) listener(state);
    }

    function engineTick(): number {
        try {
            return getWasmEngine().getFixedTickCount?.() ?? 0;
        } catch {
            return 0;
        }
    }

    function endCrit(): void {
        const pending = crit;
        crit = null;
        pending?.resolve();
    }

    /** The table went back to live without us (a throw, a click, a grab). */
    function noteReleased(): void {
        if (!active) return;
        active = false;
        playing = false;
        inFlight = false;
        endCrit();
        notify();
    }

    appEvents.on(AppEvent.ROLL_STARTED, () => {
        rolling = true;
        settled = null;
        lastReason = 'no-roll';
        // ThrowRecord already handed the table back before the throw.
        noteReleased();
        notify();
    });

    appEvents.on(AppEvent.ROLL_SETTLED, (payload) => {
        rolling = false;
        const done = payload as { results?: SettledDieRow[] } | undefined;
        const record = getLastThrowRecord();
        if (!record) {
            settled = null;
            lastReason = 'unseeded';
            notify();
            return;
        }
        // The end of the timeline: the engine's tick as the settle is reported.
        // That is a little past the moment the dice stopped (the sleep timer,
        // then the worker's idle streak before it parks), never before it, so
        // seeking to it lands on the settled pose.
        const settleTick = engineTick();
        const serial = record.serial;
        pendingSerial = serial;
        const slots = record.tableIds.length
            ? record.spec.dice.map((d) => record.tableIds.indexOf(d.id)).filter((slot) => slot >= 0)
            : null;
        const results = Array.isArray(done?.results) ? done.results : [];
        const accept = (base: ReplayBase | null) => {
            if (pendingSerial !== serial || rolling) return;
            if (!base) {
                settled = null;
                lastReason = 'snapshot-mismatch';
            } else {
                settled = {
                    record,
                    base,
                    endTick: Math.max(0, settleTick - base.startTick),
                    results,
                    slots: slots && slots.length < record.tableIds.length ? slots : null,
                };
                lastReason = null;
            }
            notify();
        };
        // Synchronously when the base is in (it always is by the settle: one
        // worker round trip), so the crit cam can ask right after this event.
        if (record.resolvedBase !== undefined) accept(record.resolvedBase);
        else void record.base.then(accept);
    });

    async function ensureEntered(): Promise<boolean> {
        if (active && isReplayActive()) return true;
        if (!(await replayEnter())) return false;
        active = true;
        return true;
    }

    async function seekInternal(target: number): Promise<ReplayFrame | null> {
        const why = refusal();
        if (why || !settled) {
            lastReason = why ?? lastReason;
            return null;
        }
        const roll = settled;
        const to = clampTick(target, roll.endTick);
        inFlight = true;
        try {
            if (!(await ensureEntered())) return null;
            const frame = await replaySeek(roll.base, roll.record.spec, to);
            if (!frame) {
                // The world no longer matches the snapshot: give the table back.
                lastReason = 'snapshot-mismatch';
                settled = null;
                await live();
                return null;
            }
            tick = frame.tick;
            carry = 0;
            return frame;
        } finally {
            inFlight = false;
            notify();
        }
    }

    async function seek(target: number): Promise<ReplayFrame | null> {
        playing = false;
        return seekInternal(target);
    }

    async function play(nextRate = 1, options: { from?: number } = {}): Promise<boolean> {
        if (!settled) return false;
        const from = options.from ?? (active && tick < settled.endTick ? tick : 0);
        if (!active || from !== tick) {
            if (!(await seekInternal(from))) return false;
        }
        rate = nextRate > 0 ? nextRate : 1;
        playing = true;
        carry = 0;
        notify();
        return true;
    }

    function pause(): void {
        if (!playing) return;
        playing = false;
        notify();
    }

    async function live(): Promise<void> {
        playing = false;
        endCrit();
        if (active || isReplayActive()) {
            active = false;
            await replayExit();
        }
        tick = settled?.endTick ?? 0;
        notify();
    }

    function beginCrit(): { crit: CritDie; done: Promise<void> } | null {
        if (refusal() || !settled) return null;
        const target = findCritDice(settled.results, settled.slots)[0];
        if (!target) return null;
        const roll = settled;
        const done = new Promise<void>((resolve) => {
            crit = { resolve };
        });
        rate = CRIT_REPLAY_RATE;
        void play(CRIT_REPLAY_RATE, { from: critReplayStartTick(roll.endTick) }).then((ok) => {
            if (!ok) endCrit();
        });
        notify();
        return { crit: target, done };
    }

    async function skip(): Promise<void> {
        await live();
    }

    function update(deltaSeconds: number): void {
        if (active && !isReplayActive()) {
            noteReleased();
            return;
        }
        if (!playing || inFlight || !settled) return;
        const remaining = settled.endTick - tick;
        if (remaining <= 0) {
            playing = false;
            if (crit) void live();
            else notify();
            return;
        }
        const step = advancePlayback(carry, deltaSeconds, rate);
        carry = step.carry;
        const n = Math.min(step.ticks, remaining);
        if (n <= 0) return;
        inFlight = true;
        void replayStep(n)
            .then((frame) => {
                if (frame) tick = frame.tick;
                else playing = false;
            })
            .finally(() => {
                inFlight = false;
                notify();
            });
    }

    return {
        getState,
        subscribe(listener) {
            listeners.add(listener);
            listener(getState());
            return () => listeners.delete(listener);
        },
        seek,
        play,
        pause,
        live,
        beginCrit,
        skip,
        update,
        refusal,
    };
}
