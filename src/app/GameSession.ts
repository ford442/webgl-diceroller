/**
 * GameSession — one `GameRules` game played on the tavern table.
 *
 * The rules (`dice-core/game/*`) are pure: they never see the scene. This is
 * the seam that does. It owns one rules state, offers the human seat its legal
 * actions, drives bot seats through their `GamePolicy`, and turns each action
 * into table moves:
 *
 *   • a throw action  → throw exactly the dice the rules ask for, with a seed
 *                       drawn from the game's own RNG, wait for *that* throw to
 *                       settle, and `apply` the faces as a `SettledRoll`;
 *   • anything else   → `apply` it, then make the jail hold what the new state
 *                       says is set aside (and free what it says is not).
 *
 * The jail is therefore a pure function of the rules state — hot dice, a bust
 * and a bank all fall out of one `syncHeld()` — and the session never keeps a
 * second copy of the score. A bot reads `rules.view()` and nothing else, and
 * its throws go through the same `GameTable.throw` the human's do.
 *
 * No DOM and no Three here: the table is a small interface (`GameTable`) the
 * wiring implements over the real scene and a test implements over a fake.
 */

import {
    IllegalActionError,
    type ActionLogEntry,
    type GamePolicy,
    type GameRules,
    type Outcome,
    type SeatId,
    type SeededRng,
    type SettledRoll,
    type ThrowDie,
} from 'dice-core/game/GameRules';

/** How a throw ended, as the table reads it back for the dice that were thrown. */
export interface TableThrow {
    /** Faces index-aligned with the physics ids asked for; null = unreadable. */
    values: Array<number | null>;
    /** Asked-for physics ids whose die never lay flat. Only a timed-out roll has any. */
    cocked: number[];
    timedOut: boolean;
    reason: string | null;
    /** Another roll started before this one settled, so `values` are not this throw's. */
    superseded: boolean;
}

/** Everything the session needs from the scene. The wiring implements it. */
export interface GameTable {
    /**
     * Put exactly these dice on the table (replacing the current dice set) and
     * resolve to their physics ids, aligned with `dice`. Rejects when the table
     * cannot host them (no physics, too few dice registered).
     */
    seat(dice: readonly ThrowDie[]): Promise<number[]>;
    /** Give the table back the way `seat` found it. */
    restore(): Promise<void>;
    /** Still true while every one of `ids` is on the table. */
    present(ids: readonly number[]): boolean;
    /** Physics ids currently held in the jail. */
    heldIds(): number[];
    hold(ids: readonly number[]): number;
    /** Free held dice (all, when `ids` is omitted); they stay where they are. */
    release(ids?: readonly number[]): number;
    /** Throw exactly `ids` with `seed` and resolve once this throw settles. */
    throw(ids: readonly number[], seed: number): Promise<TableThrow>;
    /** While locked, a click on the jail does not toggle it behind the rules' back. */
    setLocked(reason: string | null): void;
}

export interface GameSeat<A, V> {
    id: SeatId;
    name: string;
    /** Present = a bot seat. Absent = a person, who acts through `submit`. */
    policy?: GamePolicy<A, V>;
}

export interface GameSessionConfig<S, A, V> {
    rules: GameRules<S, A, V>;
    table: GameTable;
    /** Every die the game plays with. Rules die id `i` is `dice[i]`'s `id`. */
    dice: readonly ThrowDie[];
    /** Rules die ids the state has set aside (must be held in the jail). */
    heldDice(state: S): readonly number[];
    seats: ReadonlyArray<GameSeat<A, V>>;
    createRng: (seed: number) => SeededRng;
    /** Seeds `rules.init` and every throw — the whole game follows from it. */
    seed: number;
    /** Pauses that make bot play watchable. Zero (the default) in tests. */
    pace?: { think?: number; afterThrow?: number };
    wait?: (ms: number) => Promise<void>;
    /** Throws a bot (or the no-settle backstop) may redo for cocked dice before accepting. */
    maxAutoRethrows?: number;
}

export type GamePhase =
    | 'seating'
    | 'your-turn'
    /** The person has acted; the session is applying it (and throwing, if it throws). */
    | 'acting'
    | 'bot-turn'
    | 'throwing'
    | 'cocked'
    | 'over'
    | 'stopped';

/** The throw in flight, or the last one, for the panel to show. */
export interface GameThrowInfo {
    seat: SeatId;
    /** Rules die ids thrown, in throw order. */
    dice: number[];
    /** Faces once settled (aligned with `dice`); null while the dice are in the air. */
    faces: number[] | null;
    /** Rules die ids of dice that never lay flat on the last attempt. */
    cocked: number[];
    /** 1 for the first throw; counts re-throws of the same action. */
    attempt: number;
    seed: number;
}

export interface GameSnapshot<S, A> {
    rulesId: string;
    phase: GamePhase;
    state: S;
    seats: ReadonlyArray<{ id: SeatId; name: string; bot: boolean }>;
    toAct: SeatId | null;
    /** What the seat to act may do; empty unless a person is on turn. */
    legal: A[];
    throwing: GameThrowInfo | null;
    notice: string | null;
    outcome: Outcome | null;
    log: ReadonlyArray<ActionLogEntry<A>>;
    seed: number;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

export type PreviewResult<S> = { ok: true; state: S } | { ok: false; error: string };

export interface GameSession<S, A, V> {
    /** Seats the dice and plays until the game ends or `stop()`. Resolves with the outcome (null if stopped). */
    start(): Promise<Outcome | null>;
    /** The person on turn takes an action. Rejected, with the reason, if it is not theirs to take. */
    submit(action: A): SubmitResult;
    /** What `action` would do to the state, without doing it. Pure — never touches the table. */
    preview(action: A): PreviewResult<S>;
    /** The person on turn throws the cocked dice again. */
    rethrow(): SubmitResult;
    stop(notice?: string | null): Promise<void>;
    getSnapshot(): GameSnapshot<S, A>;
    subscribe(listener: (snapshot: GameSnapshot<S, A>) => void): () => void;
    isActive(): boolean;
    /** The rules this session plays — for views that must not re-implement them. */
    readonly rules: GameRules<S, A, V>;
}

/** An action the human is waiting to give, or a request to throw again. */
type HumanMove<A> = { kind: 'action'; action: A } | { kind: 'rethrow' } | { kind: 'abort' };

const DEFAULT_AUTO_RETHROWS = 3;
const SEED_RANGE = 0x1_0000_0000;

function sameAction(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function createGameSession<S, A, V>(
    config: GameSessionConfig<S, A, V>
): GameSession<S, A, V> {
    const { rules, table, dice, seats } = config;
    const wait = config.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const pace = { think: config.pace?.think ?? 0, afterThrow: config.pace?.afterThrow ?? 0 };
    const maxAutoRethrows = config.maxAutoRethrows ?? DEFAULT_AUTO_RETHROWS;
    const seatIds = seats.map((s) => s.id);

    const rng = config.createRng(config.seed);
    let state = rules.init(seatIds, rng);
    const log: ActionLogEntry<A>[] = [];

    let phase: GamePhase = 'seating';
    let notice: string | null = null;
    let throwing: GameThrowInfo | null = null;
    let outcome: Outcome | null = null;
    let stopped = false;
    let started = false;
    let tableIds: number[] = [];

    const listeners = new Set<(snapshot: GameSnapshot<S, A>) => void>();
    let pendingHuman: ((move: HumanMove<A>) => void) | null = null;
    let waitingFor: 'action' | 'rethrow' | null = null;

    const seatFor = (id: SeatId | null) => seats.find((s) => s.id === id) ?? null;
    const tableIdOf = (dieId: number): number => {
        const index = dice.findIndex((d) => d.id === dieId);
        const id = index < 0 ? undefined : tableIds[index];
        if (id === undefined) throw new Error(`${rules.id}: no table die for game die ${dieId}.`);
        return id;
    };
    const dieIdOf = (physicsId: number): number => {
        const index = tableIds.indexOf(physicsId);
        const die = index < 0 ? undefined : dice[index];
        if (!die) throw new Error(`${rules.id}: table die ${physicsId} is not in this game.`);
        return die.id;
    };

    function legalForHuman(): A[] {
        const seat = rules.toAct(state);
        if (seat === null || phase !== 'your-turn' || waitingFor !== 'action') return [];
        return rules.legalActions(state, seat);
    }

    function snapshot(): GameSnapshot<S, A> {
        return {
            rulesId: rules.id,
            phase,
            state,
            seats: seats.map((s) => ({ id: s.id, name: s.name, bot: s.policy !== undefined })),
            toAct: rules.toAct(state),
            legal: legalForHuman(),
            throwing,
            notice,
            outcome,
            log: [...log],
            seed: config.seed,
        };
    }

    function emit(): void {
        const view = snapshot();
        for (const listener of [...listeners]) {
            try {
                listener(view);
            } catch (err) {
                console.error('[GameSession] listener error', err);
            }
        }
    }

    function setPhase(next: GamePhase, nextNotice: string | null = null): void {
        phase = next;
        notice = nextNotice;
        emit();
    }

    function nextHuman(kind: 'action' | 'rethrow'): Promise<HumanMove<A>> {
        return new Promise((resolve) => {
            waitingFor = kind;
            pendingHuman = (move) => {
                pendingHuman = null;
                waitingFor = null;
                resolve(move);
            };
        });
    }

    /** Make the jail hold exactly what the rules say is set aside. */
    function syncHeld(): void {
        const want = new Set(heldDiceIds());
        const have = new Set(table.heldIds());
        const free = [...have].filter((id) => !want.has(id));
        const keep = [...want].filter((id) => !have.has(id));
        if (free.length) table.release(free);
        if (keep.length) table.hold(keep);
    }

    function heldDiceIds(): number[] {
        return config.heldDice(state).map(tableIdOf);
    }

    function drawSeed(): number {
        return Math.floor(rng() * SEED_RANGE) >>> 0;
    }

    /** Throw `action`'s dice until they land readable; returns the roll to apply. */
    async function throwFor(
        seat: GameSeat<A, V>,
        request: { dice: ThrowDie[] }
    ): Promise<SettledRoll | null> {
        const dieIds = request.dice.map((d) => d.id);
        const ids = dieIds.map(tableIdOf);
        // The rules free these dice (hot dice frees all six); the jail may
        // still hold them. A throw never poses a held id.
        table.release(ids);

        for (let attempt = 1; ; attempt++) {
            if (stopped) return null;
            if (!table.present(tableIds)) {
                await abort('The dice on the table changed — game ended.');
                return null;
            }
            const seed = drawSeed();
            throwing = { seat: seat.id, dice: dieIds, faces: null, cocked: [], attempt, seed };
            setPhase('throwing');

            const landed = await table.throw(ids, seed);
            if (stopped) return null;

            if (landed.superseded) {
                // Something else rolled the table while this was in the air: its
                // faces are not ours. Throw again rather than read someone else's.
                if (attempt > maxAutoRethrows) {
                    await abort('Another roll kept interrupting the game — game ended.');
                    return null;
                }
                continue;
            }

            const faces = landed.values;
            if (landed.cocked.length === 0 && faces.every((v): v is number => v !== null)) {
                throwing = {
                    seat: seat.id,
                    dice: dieIds,
                    faces: [...faces],
                    cocked: [],
                    attempt,
                    seed,
                };
                if (pace.afterThrow) await wait(pace.afterThrow);
                return { faces: [...faces], seed };
            }

            // A cocked die is a re-roll of that throw — the same offer the
            // results HUD makes — never a face the rules would have to guess at.
            throwing = {
                seat: seat.id,
                dice: dieIds,
                faces: faces.map((v) => v ?? 0),
                cocked: landed.cocked.map(dieIdOf),
                attempt,
                seed,
            };
            if (seat.policy) {
                // A bot has no hand to offer: it throws again, but not forever.
                if (attempt > maxAutoRethrows) {
                    await abort('The dice would not settle — game ended.');
                    return null;
                }
                setPhase('throwing', 'A die came to rest cocked — throwing again.');
                if (pace.afterThrow) await wait(pace.afterThrow);
                continue;
            }
            // Register the wait before publishing the phase: the snapshot a
            // panel renders from must already be one `rethrow()` is accepted in.
            const waiting = nextHuman('rethrow');
            setPhase('cocked', 'A die came to rest cocked. Throw again.');
            const move = await waiting;
            if (move.kind === 'abort' || stopped) return null;
        }
    }

    async function perform(seat: GameSeat<A, V>, action: A): Promise<boolean> {
        const request = rules.throwFor(state, action);
        let roll: SettledRoll | undefined;
        if (request) {
            const landed = await throwFor(seat, request);
            if (!landed) return false;
            roll = landed;
        }
        state = rules.apply(state, action, roll);
        log.push(roll ? { seat: seat.id, action, roll } : { seat: seat.id, action });
        notice = null;
        syncHeld();
        emit();
        return true;
    }

    async function abort(message: string): Promise<void> {
        await stop(message);
    }

    async function stop(message: string | null = null): Promise<void> {
        if (stopped) return;
        stopped = true;
        pendingHuman?.({ kind: 'abort' });
        if (started) {
            table.release();
            table.setLocked(null);
            await table.restore();
        }
        throwing = null;
        phase = outcome ? 'over' : 'stopped';
        notice = message;
        emit();
    }

    async function run(): Promise<Outcome | null> {
        if (started) throw new Error(`${rules.id}: this session already started.`);
        started = true;
        try {
            tableIds = await table.seat(dice);
            table.release();
            table.setLocked(`${rules.id} is holding the dice jail`);
            syncHeld();
            emit();

            while (!stopped) {
                const done = rules.outcome(state);
                if (done) {
                    outcome = done;
                    throwing = null;
                    // The dice stay as they lie for the closing look; the panel
                    // offers a new game or closing (which `stop`s and restores).
                    phase = 'over';
                    notice = null;
                    emit();
                    return done;
                }
                const seatId = rules.toAct(state);
                const seat = seatFor(seatId);
                if (!seat) throw new Error(`${rules.id}: no seat "${seatId}" at this table.`);

                let action: A;
                if (seat.policy) {
                    setPhase('bot-turn');
                    if (pace.think) await wait(pace.think);
                    if (stopped) break;
                    const legal = rules.legalActions(state, seat.id);
                    if (!legal.length)
                        throw new Error(`${rules.id}: "${seat.id}" has no legal action.`);
                    action = seat.policy(rules.view(state, seat.id), legal, seat.id);
                } else {
                    const waiting = nextHuman('action');
                    setPhase('your-turn');
                    const move = await waiting;
                    if (move.kind !== 'action' || stopped) break;
                    action = move.action;
                }
                if (!(await perform(seat, action))) break;
            }
        } catch (err) {
            console.error('[GameSession] game failed', err);
            await stop(`The game stopped: ${err instanceof Error ? err.message : String(err)}`);
        }
        return outcome;
    }

    function preview(action: A): PreviewResult<S> {
        try {
            return { ok: true, state: rules.apply(state, action) };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    function submit(action: A): SubmitResult {
        if (stopped || waitingFor !== 'action' || !pendingHuman) {
            return { ok: false, error: 'It is not your turn to act.' };
        }
        const seat = rules.toAct(state);
        if (seat === null) return { ok: false, error: 'The game is over.' };
        if (rules.throwFor(state, action)) {
            // A throw takes no arguments the person could get wrong — it must
            // simply be one the rules offer right now.
            if (!rules.legalActions(state, seat).some((legal) => sameAction(legal, action))) {
                return { ok: false, error: 'That throw is not allowed right now.' };
            }
        } else {
            // Not every legal keep is listed (the rules list one per value
            // multiset), so ask the rules themselves.
            const tried = preview(action);
            if (!tried.ok) return tried;
        }
        // Close the door before anything else can knock: until the loop is back
        // on a person's turn there are no legal actions to offer or accept.
        pendingHuman({ kind: 'action', action });
        phase = 'acting';
        notice = null;
        emit();
        return { ok: true };
    }

    function rethrow(): SubmitResult {
        if (stopped || waitingFor !== 'rethrow' || !pendingHuman) {
            return { ok: false, error: 'Nothing to throw again.' };
        }
        pendingHuman({ kind: 'rethrow' });
        phase = 'acting';
        notice = null;
        emit();
        return { ok: true };
    }

    return {
        rules,
        start: run,
        submit,
        preview,
        rethrow,
        stop,
        getSnapshot: snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        isActive: () => started && !stopped && outcome === null,
    };
}

export { IllegalActionError };
