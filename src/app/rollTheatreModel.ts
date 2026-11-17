/**
 * Pure helpers for the roll theatre (no Three, no DOM, no engine): which dice
 * earn the crit cam, and the tick arithmetic for seeking and slow playback.
 */

import { SIM_FIXED_DT } from 'dice-core/wasm/SimClock';

/** How far before the settle the crit cam starts its slow replay. */
export const CRIT_REPLAY_SECONDS = 1.5;
/** The crit cam's playback rate. */
export const CRIT_REPLAY_RATE = 0.25;

export interface SettledDieRow {
    type: string;
    value: number | null;
    cocked?: boolean;
    role?: string | null;
}

export interface CritDie {
    /** Table slot (index into the settled results). */
    slot: number;
    kind: 'max' | 'min';
    sides: number;
}

function sidesOf(type: string): number | null {
    const match = /^d(\d+)$/.exec(type);
    return match ? Number(match[1]) : null;
}

/**
 * Dice that landed their maximum or their minimum: a natural 20 or a natural
 * 1. A cocked die read off its tilt is not a natural anything, and a
 * percentile pair (`role` tens / ones) reads its face as a digit, so neither
 * counts. With `slots`, only the dice the throw moved are considered (a die
 * held in the jail did not just roll its 20).
 */
export function findCritDice(
    results: readonly SettledDieRow[],
    slots: readonly number[] | null = null
): CritDie[] {
    const moved = slots ? new Set(slots) : null;
    const crits: CritDie[] = [];
    results.forEach((row, slot) => {
        if (moved && !moved.has(slot)) return;
        if (!row || row.cocked || row.value == null || row.role) return;
        const sides = sidesOf(row.type);
        if (sides == null || sides < 2) return;
        if (row.value === sides) crits.push({ slot, kind: 'max', sides });
        else if (row.value === 1) crits.push({ slot, kind: 'min', sides });
    });
    // A max outranks a min, then the bigger die: the d20 is the one to watch.
    crits.sort((a, b) =>
        a.kind !== b.kind ? (a.kind === 'max' ? -1 : 1) : b.sides - a.sides || a.slot - b.slot
    );
    return crits;
}

export function secondsToTicks(seconds: number): number {
    return Math.max(0, Math.round(seconds / SIM_FIXED_DT));
}

export function ticksToSeconds(ticks: number): number {
    return ticks * SIM_FIXED_DT;
}

/** First tick of the crit cam's slow replay for a roll that settled at `endTick`. */
export function critReplayStartTick(endTick: number): number {
    return Math.max(0, endTick - secondsToTicks(CRIT_REPLAY_SECONDS));
}

/**
 * Turn a frame's elapsed wall time into whole fixed ticks of playback at
 * `rate` (1 = real time, 0.25 = quarter speed), carrying the remainder.
 */
export function advancePlayback(
    carry: number,
    deltaSeconds: number,
    rate: number
): { ticks: number; carry: number } {
    if (!(deltaSeconds > 0) || !(rate > 0)) return { ticks: 0, carry };
    // A long frame (tab switch) must not leap through the replay.
    const total = carry + Math.min(deltaSeconds, 0.25) * rate;
    const ticks = Math.floor(total / SIM_FIXED_DT + 1e-9);
    return { ticks, carry: total - ticks * SIM_FIXED_DT };
}

export function clampTick(tick: number, endTick: number): number {
    if (!Number.isFinite(tick)) return 0;
    return Math.max(0, Math.min(endTick, Math.round(tick)));
}
