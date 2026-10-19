/**
 * Farkle — six d6, push your luck. The first `GameRules` game: no hidden
 * state, but it needs dice *held* between throws (the dice jail's "kept"
 * area) and partial re-throws of the rest.
 *
 * A turn: throw the free dice. No scoring die in the throw is a bust (the
 * turn's points are lost). Otherwise set aside one or more scoring dice, then
 * bank the turn's points or throw what is left. Setting aside all six ("hot
 * dice") frees all six again. Reaching the target score gives every other
 * seat one last turn; the highest total wins.
 *
 * Scoring (one fixed table, the common "doubling" variant):
 *   single 1 = 100, single 5 = 50
 *   three of a kind = face × 100 (three 1s = 1000); each extra die doubles it
 *   1-2-3-4-5-6 straight = 1500, three pairs (any six dice in even counts) = 1500
 */

import {
    IllegalActionError,
    type GameRules,
    type Outcome,
    type SeatId,
    type SeededRng,
    type SettledRoll,
    type ThrowRequest,
} from './GameRules.js';

export const FARKLE_DICE = 6;
export const FARKLE_DIE_TYPE = 'd6';
export const FARKLE_STRAIGHT = 1500;
export const FARKLE_THREE_PAIRS = 1500;

const KIND_BASE = [0, 1000, 200, 300, 400, 500, 600] as const;
const SINGLE = [0, 100, 0, 0, 0, 50, 0] as const;

export interface FarkleConfig {
    /** Banking to this total starts the final round. */
    targetScore: number;
    /**
     * Hard stop after this many full rounds (highest total wins), so a game
     * always ends — bot play in CI must not depend on luck to terminate.
     */
    maxRounds: number;
}

export const DEFAULT_FARKLE_CONFIG: FarkleConfig = { targetScore: 10_000, maxRounds: 200 };

export interface FarkleDie {
    id: number;
    /** Face showing; null before the die's first throw this turn. */
    value: number | null;
    /** Set aside this turn (parked in the jail); not thrown again until hot dice. */
    kept: boolean;
}

export type FarklePhase = 'roll' | 'keep' | 'decide' | 'over';

export interface FarkleTurnResult {
    seat: SeatId;
    result: 'bank' | 'bust';
    points: number;
    /** The busting throw's faces (a bank has none). */
    faces: number[];
}

export interface FarkleState {
    config: FarkleConfig;
    seats: SeatId[];
    scores: Record<SeatId, number>;
    /** Index into `seats` of the seat on turn. */
    current: number;
    phase: FarklePhase;
    dice: FarkleDie[];
    /** Ids of the dice the last throw landed (candidates for a keep). */
    thrown: number[];
    turnScore: number;
    /** 1-based; advances when play passes back to `seats[0]`. */
    round: number;
    /** Turns left in the final round, once a seat has banked to the target. */
    finalTurnsLeft: number | null;
    lastTurn: FarkleTurnResult | null;
    endReason: string | null;
}

export type FarkleAction = { type: 'roll' } | { type: 'keep'; dice: number[] } | { type: 'bank' };

function faceCounts(values: readonly number[]): number[] {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const v of values) {
        if (!Number.isInteger(v) || v < 1 || v > 6) {
            throw new IllegalActionError(`Farkle: ${v} is not a d6 face.`);
        }
        counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
}

function kindScore(face: number, n: number): number {
    return n < 3 ? 0 : (KIND_BASE[face] ?? 0) * 2 ** (n - 3);
}

/**
 * Best score for `count` dice of `face`. `useAll`: every die must score
 * (a keep), else non-scoring leftovers are ignored (best available).
 */
function faceScore(face: number, count: number, useAll: boolean): number | null {
    const single = SINGLE[face] ?? 0;
    let best: number | null = null;
    for (const k of [0, 3, 4, 5, 6]) {
        if (k > count) break;
        const rest = count - k;
        if (useAll && rest > 0 && single === 0) continue;
        const s = kindScore(face, k) + rest * single;
        if (best === null || s > best) best = s;
    }
    return best;
}

function sixDiceBonus(counts: readonly number[], n: number): number {
    if (n !== FARKLE_DICE) return 0;
    let best = 0;
    if (counts.slice(1).every((c) => c === 1)) best = FARKLE_STRAIGHT;
    if (counts.slice(1).every((c) => c % 2 === 0)) best = Math.max(best, FARKLE_THREE_PAIRS);
    return best;
}

/**
 * Score of setting aside exactly `values`, or null when one of them does not
 * score (not a legal keep). The empty selection is not a keep either.
 */
export function scoreFarkleKeep(values: readonly number[]): number | null {
    if (!values.length) return null;
    const counts = faceCounts(values);
    let total = 0;
    let valid = true;
    for (let face = 1; face <= 6; face++) {
        const s = faceScore(face, counts[face] ?? 0, true);
        if (s === null) valid = false;
        else total += s;
    }
    const bonus = sixDiceBonus(counts, values.length);
    if (!valid) return bonus || null;
    return Math.max(total, bonus);
}

/** The most a throw can score (0 = a bust). */
export function bestFarkleScore(values: readonly number[]): number {
    const counts = faceCounts(values);
    let total = 0;
    for (let face = 1; face <= 6; face++) total += faceScore(face, counts[face] ?? 0, false) ?? 0;
    return Math.max(total, sixDiceBonus(counts, values.length));
}

function freshDice(): FarkleDie[] {
    return Array.from({ length: FARKLE_DICE }, (_, id) => ({ id, value: null, kept: false }));
}

function freeDice(state: FarkleState): FarkleDie[] {
    return state.dice.filter((d) => !d.kept);
}

function seatAt(state: FarkleState): SeatId {
    const seat = state.seats[state.current];
    if (seat === undefined) throw new Error('Farkle: current seat out of range.');
    return seat;
}

function leaders(scores: Record<SeatId, number>, seats: SeatId[]): SeatId[] {
    const top = Math.max(...seats.map((s) => scores[s] ?? 0));
    return seats.filter((s) => (scores[s] ?? 0) === top);
}

/** Close the current turn: next seat, round / final-round bookkeeping. */
function endTurn(state: FarkleState, lastTurn: FarkleTurnResult): FarkleState {
    const seatTotal = state.scores[lastTurn.seat] ?? 0;
    let finalTurnsLeft = state.finalTurnsLeft;
    if (finalTurnsLeft !== null) finalTurnsLeft -= 1;
    else if (seatTotal >= state.config.targetScore) finalTurnsLeft = state.seats.length - 1;

    const next = (state.current + 1) % state.seats.length;
    const round = next === 0 ? state.round + 1 : state.round;
    let phase: FarklePhase = 'roll';
    let endReason: string | null = null;
    if (finalTurnsLeft !== null && finalTurnsLeft <= 0) {
        phase = 'over';
        endReason = 'target';
    } else if (round > state.config.maxRounds) {
        phase = 'over';
        endReason = 'maxRounds';
    }
    return {
        ...state,
        current: next,
        round,
        phase,
        dice: freshDice(),
        thrown: [],
        turnScore: 0,
        finalTurnsLeft,
        lastTurn,
        endReason,
    };
}

function applyRoll(state: FarkleState, roll: SettledRoll | undefined): FarkleState {
    const free = freeDice(state);
    if (!roll || roll.faces.length !== free.length) {
        throw new IllegalActionError(
            `Farkle: a roll of ${free.length} dice needs ${free.length} faces, got ${roll?.faces.length ?? 'none'}.`
        );
    }
    faceCounts(roll.faces);
    const faceById = new Map(free.map((d, i) => [d.id, roll.faces[i] ?? 0]));
    const dice = state.dice.map((d) => (d.kept ? d : { ...d, value: faceById.get(d.id) ?? null }));
    if (bestFarkleScore(roll.faces) === 0) {
        const seat = seatAt(state);
        return endTurn(
            { ...state, dice },
            { seat, result: 'bust', points: 0, faces: [...roll.faces] }
        );
    }
    return { ...state, dice, thrown: free.map((d) => d.id), phase: 'keep' };
}

function applyKeep(state: FarkleState, ids: readonly number[]): FarkleState {
    const sorted = [...ids].sort((a, b) => a - b);
    const thrown = new Set(state.thrown);
    if (!sorted.length || new Set(sorted).size !== sorted.length) {
        throw new IllegalActionError('Farkle: keep needs one or more distinct dice.');
    }
    const values: number[] = [];
    for (const id of sorted) {
        const die = state.dice[id];
        if (!thrown.has(id) || !die || die.kept || die.value === null) {
            throw new IllegalActionError(`Farkle: die ${id} was not in the last throw.`);
        }
        values.push(die.value);
    }
    const score = scoreFarkleKeep(values);
    if (score === null) {
        throw new IllegalActionError(`Farkle: [${values.join(', ')}] does not all score.`);
    }
    const keep = new Set(sorted);
    let dice = state.dice.map((d) => (keep.has(d.id) ? { ...d, kept: true } : d));
    // Hot dice: all six set aside — throw all six again.
    if (dice.every((d) => d.kept)) dice = dice.map((d) => ({ ...d, kept: false }));
    return { ...state, dice, thrown: [], turnScore: state.turnScore + score, phase: 'decide' };
}

/** Distinct scoring subsets of the last throw, one per value multiset. */
function keepOptions(state: FarkleState): number[][] {
    const thrown = state.thrown;
    const seen = new Set<string>();
    const options: number[][] = [];
    for (let mask = 1; mask < 1 << thrown.length; mask++) {
        const ids = thrown.filter((_, i) => mask & (1 << i));
        const values = ids.map((id) => state.dice[id]?.value ?? 0);
        const key = [...values].sort((a, b) => a - b).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        if (scoreFarkleKeep(values) !== null) options.push(ids);
    }
    return options;
}

export function createFarkleRules(
    config: Partial<FarkleConfig> = {}
): GameRules<FarkleState, FarkleAction, FarkleState> {
    const cfg: FarkleConfig = { ...DEFAULT_FARKLE_CONFIG, ...config };
    return {
        id: 'farkle',
        seats: { min: 1, max: 8 },

        init(seats: SeatId[], _rng: SeededRng): FarkleState {
            if (seats.length < 1 || seats.length > 8 || new Set(seats).size !== seats.length) {
                throw new IllegalActionError('Farkle: 1–8 distinct seats.');
            }
            return {
                config: cfg,
                seats: [...seats],
                scores: Object.fromEntries(seats.map((s) => [s, 0])),
                current: 0,
                phase: 'roll',
                dice: freshDice(),
                thrown: [],
                turnScore: 0,
                round: 1,
                finalTurnsLeft: null,
                lastTurn: null,
                endReason: null,
            };
        },

        toAct(state) {
            return state.phase === 'over' ? null : seatAt(state);
        },

        legalActions(state, seat) {
            if (state.phase === 'over' || seat !== seatAt(state)) return [];
            if (state.phase === 'roll') return [{ type: 'roll' }];
            if (state.phase === 'keep') {
                return keepOptions(state).map((dice) => ({ type: 'keep', dice }));
            }
            return [{ type: 'roll' }, { type: 'bank' }];
        },

        throwFor(state, action): ThrowRequest | null {
            if (action.type !== 'roll') return null;
            return { dice: freeDice(state).map(({ id }) => ({ id, type: FARKLE_DIE_TYPE })) };
        },

        apply(state, action, roll) {
            if (state.phase === 'over') throw new IllegalActionError('Farkle: the game is over.');
            switch (action.type) {
                case 'roll':
                    if (state.phase !== 'roll' && state.phase !== 'decide') break;
                    return applyRoll(state, roll);
                case 'keep':
                    if (state.phase !== 'keep') break;
                    return applyKeep(state, action.dice);
                case 'bank': {
                    if (state.phase !== 'decide') break;
                    const seat = seatAt(state);
                    const scores = {
                        ...state.scores,
                        [seat]: (state.scores[seat] ?? 0) + state.turnScore,
                    };
                    return endTurn(
                        { ...state, scores },
                        { seat, result: 'bank', points: state.turnScore, faces: [] }
                    );
                }
            }
            throw new IllegalActionError(
                `Farkle: "${action.type}" is not legal in "${state.phase}".`
            );
        },

        // No hidden dice in Farkle: every seat sees the whole table.
        view(state) {
            return state;
        },

        outcome(state): Outcome | null {
            if (state.phase !== 'over') return null;
            return {
                winners: leaders(state.scores, state.seats),
                scores: { ...state.scores },
                reason: state.endReason ?? 'target',
            };
        },
    };
}
