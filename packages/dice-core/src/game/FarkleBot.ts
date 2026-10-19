/**
 * A one-step expected-value Farkle bot. For n free dice it knows, exactly,
 * the chance a throw busts and the mean best score of a throw that does not
 * (all 6^n outcomes, enumerated once). It throws again while
 * `(1 - bust) × (turn + gain)` beats banking `turn`, and picks the keep that
 * maximises the better of the two afterwards. Deliberately simple: a seat a
 * person can beat, and a deterministic player for CI.
 */

import {
    FARKLE_DICE,
    bestFarkleScore,
    scoreFarkleKeep,
    type FarkleAction,
    type FarkleState,
} from './Farkle.js';
import type { GamePolicy, SeatId } from './GameRules.js';

export interface FarkleRollStats {
    /** Probability a throw of n dice scores nothing. */
    bustChance: number;
    /** Mean best score of a throw of n dice, given it did not bust. */
    meanGain: number;
}

const statsCache = new Map<number, FarkleRollStats>();

/** Exact bust chance and mean non-bust gain for a throw of `n` d6. */
export function farkleRollStats(n: number): FarkleRollStats {
    const cached = statsCache.get(n);
    if (cached) return cached;
    const faces = new Array<number>(n).fill(1);
    let busts = 0;
    let gain = 0;
    const total = 6 ** n;
    for (let i = 0; i < total; i++) {
        let rest = i;
        for (let d = 0; d < n; d++) {
            faces[d] = (rest % 6) + 1;
            rest = Math.floor(rest / 6);
        }
        const best = bestFarkleScore(faces);
        if (best === 0) busts += 1;
        else gain += best;
    }
    const stats: FarkleRollStats = {
        bustChance: busts / total,
        meanGain: busts === total ? 0 : gain / (total - busts),
    };
    statsCache.set(n, stats);
    return stats;
}

/** Expected turn total of throwing `free` dice once more with `turn` at stake. */
function rollAgainValue(turn: number, free: number): number {
    const { bustChance, meanGain } = farkleRollStats(free);
    return (1 - bustChance) * (turn + meanGain);
}

/** Free dice after keeping `kept` more (all six set aside = hot dice). */
function freeAfterKeep(state: FarkleState, kept: number): number {
    const free = state.dice.filter((d) => !d.kept).length - kept;
    return free === 0 ? FARKLE_DICE : free;
}

/** Points `seat` must exceed in the final round to take the lead (null: not final). */
function finalRoundBar(state: FarkleState, seat: SeatId): number | null {
    if (state.finalTurnsLeft === null) return null;
    return Math.max(...state.seats.filter((s) => s !== seat).map((s) => state.scores[s] ?? 0));
}

/** Bank, or throw again? */
function shouldBank(state: FarkleState, seat: SeatId, turn: number, free: number): boolean {
    const banked = (state.scores[seat] ?? 0) + turn;
    const bar = finalRoundBar(state, seat);
    // Last chance: anything short of the lead loses anyway.
    if (bar !== null) return banked > bar;
    if (banked >= state.config.targetScore) return true;
    return turn >= rollAgainValue(turn, free);
}

export function createFarkleBot(): GamePolicy<FarkleAction, FarkleState> {
    return (state, legal, seat) => {
        const first = legal[0];
        if (!first) throw new Error('Farkle bot: no legal action.');
        if (state.phase === 'roll') return first;

        if (state.phase === 'decide') {
            const free = state.dice.filter((d) => !d.kept).length;
            const bank = shouldBank(state, seat, state.turnScore, free);
            return legal.find((a) => a.type === (bank ? 'bank' : 'roll')) ?? first;
        }

        let best: FarkleAction = first;
        let bestValue = -Infinity;
        let bestSize = Infinity;
        for (const action of legal) {
            if (action.type !== 'keep') continue;
            const values = action.dice.map((id) => state.dice[id]?.value ?? 0);
            const turn = state.turnScore + (scoreFarkleKeep(values) ?? 0);
            const free = freeAfterKeep(state, action.dice.length);
            const value = shouldBank(state, seat, turn, free)
                ? turn
                : Math.max(turn, rollAgainValue(turn, free));
            const size = action.dice.length;
            if (value > bestValue || (value === bestValue && size < bestSize)) {
                best = action;
                bestValue = value;
                bestSize = size;
            }
        }
        return best;
    };
}
