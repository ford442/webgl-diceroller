/**
 * GameRules — the contract every table game implements, and the driver that
 * plays one. Rules are pure: they never read the scene, a clock or a global
 * RNG. Physics (or any other roller) supplies a `SettledRoll`; the rules only
 * fold actions into state. A game is therefore replayable from
 * `(seats, seed, action log)` alone, and testable without WASM.
 */

/** A seat at the table (the session layer's seat id). */
export type SeatId = string;

/** A seeded `[0, 1)` stream — `createSeededRng(seed)` fits. */
export type SeededRng = () => number;

/** One die a rules module wants thrown: a stable die id and its type. */
export interface ThrowDie {
    id: number;
    type: string;
}

/** What to throw for an action, in the order the faces come back. */
export interface ThrowRequest {
    dice: ThrowDie[];
}

/** Faces read off a settled throw, index-aligned with `ThrowRequest.dice`. */
export interface SettledRoll {
    faces: number[];
    /** The physics seed that produced the throw (null for an unseeded pour). */
    seed: number | null;
}

/** Why and how a game ended. */
export interface Outcome {
    winners: SeatId[];
    scores: Record<SeatId, number>;
    reason: string;
}

/** Thrown by `apply` for an action `legalActions` would not have offered. */
export class IllegalActionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IllegalActionError';
    }
}

export interface GameRules<S, A, V = S> {
    id: string;
    seats: { min: number; max: number };
    init(seats: SeatId[], rng: SeededRng): S;
    /** The seat whose decision the game is waiting on, or null once it ended. */
    toAct(state: S): SeatId | null;
    legalActions(state: S, seat: SeatId): A[];
    /**
     * The dice `action` throws, or null when it throws none. An action with a
     * throw request must be applied with the matching `SettledRoll`.
     */
    throwFor(state: S, action: A): ThrowRequest | null;
    /** Pure: returns a new state, never mutates `state`. */
    apply(state: S, action: A, roll?: SettledRoll): S;
    /** What `seat` may see (hides other players' dice in hidden-dice games). */
    view(state: S, seat: SeatId): V;
    outcome(state: S): Outcome | null;
}

/** One applied action — enough to replay the game without physics. */
export interface ActionLogEntry<A> {
    seat: SeatId;
    action: A;
    roll?: SettledRoll;
}

/** Chooses an action for `seat` from what it can see. */
export type GamePolicy<A, V> = (view: V, legal: A[], seat: SeatId) => A;

/** Produces the settled faces for a throw (pure RNG, rollHeadless, the table). */
export type GameRoller = (
    request: ThrowRequest,
    seed: number
) => SettledRoll | Promise<SettledRoll>;

export interface PlayGameOptions<S, A, V> {
    rules: GameRules<S, A, V>;
    seats: SeatId[];
    /** Seeds `init` and every throw: the whole game follows from it. */
    seed: number;
    policies: Record<SeatId, GamePolicy<A, V>>;
    roller: GameRoller;
    /** Seeded `[0, 1)` stream factory (dice-core's `createSeededRng`). */
    createRng: (seed: number) => SeededRng;
    /** Fails the game rather than looping forever on a broken rules module. */
    maxActions?: number;
}

export interface PlayedGame<S, A> {
    state: S;
    outcome: Outcome;
    log: ActionLogEntry<A>[];
}

const DEFAULT_MAX_ACTIONS = 100_000;

/**
 * Play a game to its outcome. Throw seeds come from the game's own RNG, after
 * `init` has drawn from it, so `(seats, seed)` plus deterministic policies and
 * a deterministic roller reproduce the same log.
 */
export async function playGame<S, A, V>(
    options: PlayGameOptions<S, A, V>
): Promise<PlayedGame<S, A>> {
    const { rules, seats, policies, roller } = options;
    const maxActions = options.maxActions ?? DEFAULT_MAX_ACTIONS;
    const rng = options.createRng(options.seed);
    let state = rules.init(seats, rng);
    const log: ActionLogEntry<A>[] = [];

    for (let n = 0; n < maxActions; n++) {
        const outcome = rules.outcome(state);
        if (outcome) return { state, outcome, log };
        const seat = rules.toAct(state);
        if (seat === null) throw new Error(`${rules.id}: no seat to act and no outcome.`);
        const policy = policies[seat];
        if (!policy) throw new Error(`${rules.id}: no policy for seat "${seat}".`);
        const legal = rules.legalActions(state, seat);
        if (!legal.length) throw new Error(`${rules.id}: seat "${seat}" has no legal action.`);
        const action = policy(rules.view(state, seat), legal, seat);
        const request = rules.throwFor(state, action);
        const roll = request
            ? await roller(request, Math.floor(rng() * 0x1_0000_0000) >>> 0)
            : undefined;
        state = rules.apply(state, action, roll);
        log.push(roll ? { seat, action, roll } : { seat, action });
    }
    throw new Error(`${rules.id}: no outcome after ${maxActions} actions.`);
}

/** Rebuild a game's state from its log — no physics, no policies. */
export function replayGame<S, A, V>(
    rules: GameRules<S, A, V>,
    seats: SeatId[],
    rng: SeededRng,
    log: ActionLogEntry<A>[]
): S {
    let state = rules.init(seats, rng);
    for (const entry of log) {
        const seat = rules.toAct(state);
        if (seat !== entry.seat) {
            throw new IllegalActionError(
                `${rules.id}: log has "${entry.seat}" acting, expected "${seat}".`
            );
        }
        state = rules.apply(state, entry.action, entry.roll);
    }
    return state;
}

/** A physics-free roller: uniform faces from the throw seed. */
export function createRngRoller(createRng: (seed: number) => SeededRng): GameRoller {
    return (request, seed) => {
        const rng = createRng(seed);
        const faces = request.dice.map(({ type }) => {
            const sides = Number.parseInt(type.replace(/^d/, ''), 10) || 6;
            return Math.min(sides, Math.floor(rng() * sides) + 1);
        });
        return { faces, seed };
    };
}
