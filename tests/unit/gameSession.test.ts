/**
 * GameSession (src/app/GameSession.ts) on a fake table: the session is the seam
 * between pure Farkle rules and the scene, so what matters is what it asks the
 * table to do — which dice it throws, which it holds — and that the score only
 * ever moves through Farkle.apply.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    createRngRoller,
    playGame,
    replayGame,
    type SettledRoll,
    type ThrowDie,
} from 'dice-core/game/GameRules';
import {
    FARKLE_DICE,
    createFarkleRules,
    scoreFarkleKeep,
    type FarkleAction,
    type FarkleState,
} from 'dice-core/game/Farkle';
import { createFarkleBot } from 'dice-core/game/FarkleBot';
import { createSeededRng } from 'dice-core/wasm/seededThrowParams';
import {
    createGameSession,
    type GameSession,
    type GameSnapshot,
    type GameTable,
    type TableThrow,
} from '../../src/app/GameSession.js';

const FARKLE_DIE_SET: ThrowDie[] = Array.from({ length: FARKLE_DICE }, (_, id) => ({
    id,
    type: 'd6',
}));
// Physics ids are not 0..5 on a real table; make the mapping matter.
const BASE_ID = 40;

type Rules = ReturnType<typeof createFarkleRules>;
type Farkle = GameSession<FarkleState, FarkleAction, FarkleState>;

interface FakeTable extends GameTable {
    throws: Array<{ ids: number[]; seed: number; held: number[] }>;
    held: Set<number>;
    seated: number;
    restored: number;
    locked: string | null;
    gone: boolean;
    /** Override what the next throw reports (e.g. a cocked die). */
    next: Array<(ids: number[], seed: number) => Partial<TableThrow> | undefined>;
}

function fakeTable(): FakeTable {
    const roller = createRngRoller(createSeededRng);
    const table: FakeTable = {
        throws: [],
        held: new Set(),
        seated: 0,
        restored: 0,
        locked: null,
        gone: false,
        next: [],
        async seat(dice) {
            table.seated += 1;
            return dice.map((_, i) => BASE_ID + i);
        },
        async restore() {
            table.restored += 1;
        },
        present: () => !table.gone,
        heldIds: () => [...table.held].sort((a, b) => a - b),
        hold(ids) {
            ids.forEach((id) => table.held.add(id));
            return ids.length;
        },
        release(ids) {
            const targets = ids ?? [...table.held];
            targets.forEach((id) => table.held.delete(id));
            return targets.length;
        },
        async throw(ids, seed) {
            table.throws.push({ ids: [...ids], seed, held: table.heldIds() });
            const rolled = roller(
                { dice: ids.map((id) => ({ id, type: 'd6' })) },
                seed
            ) as SettledRoll;
            const override = table.next.shift()?.(ids, seed);
            return {
                values: rolled.faces,
                cocked: [],
                timedOut: false,
                reason: null,
                superseded: false,
                ...override,
            };
        },
        setLocked(reason) {
            table.locked = reason;
        },
    };
    return table;
}

function build(
    table: FakeTable,
    seats: Array<{ id: string; name: string; bot?: boolean }>,
    seed = 2024,
    rules: Rules = createFarkleRules()
): Farkle {
    const bot = createFarkleBot();
    return createGameSession<FarkleState, FarkleAction, FarkleState>({
        rules,
        table,
        dice: FARKLE_DIE_SET,
        heldDice: (state) => state.dice.filter((d) => d.kept).map((d) => d.id),
        seats: seats.map((s) => ({
            id: s.id,
            name: s.name,
            ...(s.bot ? { policy: bot } : {}),
        })),
        createRng: createSeededRng,
        seed,
    });
}

/** Resolve when the session reaches `phase` (or already is there). */
function until(session: Farkle, phase: GameSnapshot<FarkleState, FarkleAction>['phase']) {
    return new Promise<GameSnapshot<FarkleState, FarkleAction>>((resolve) => {
        if (session.getSnapshot().phase === phase) {
            resolve(session.getSnapshot());
            return;
        }
        const off = session.subscribe((snap) => {
            if (snap.phase !== phase) return;
            off();
            resolve(snap);
        });
    });
}

/** A scoring keep for the human: the rules' own option with the most dice. */
function biggestKeep(snap: GameSnapshot<FarkleState, FarkleAction>): FarkleAction {
    const keeps = snap.legal.filter((a) => a.type === 'keep');
    return keeps.reduce((best, a) =>
        a.type === 'keep' && best.type === 'keep' && a.dice.length > best.dice.length ? a : best
    );
}

describe('GameSession — bots on the table', () => {
    it('plays a bot-vs-bot game to an outcome identical to the headless game', async () => {
        const table = fakeTable();
        const session = build(table, [
            { id: 'north', name: 'North', bot: true },
            { id: 'south', name: 'South', bot: true },
        ]);
        const outcome = await session.start();

        const rules = createFarkleRules();
        const bot = createFarkleBot();
        const headless = await playGame({
            rules,
            seats: ['north', 'south'],
            seed: 2024,
            policies: { north: bot, south: bot },
            roller: createRngRoller(createSeededRng),
            createRng: createSeededRng,
        });

        // Same seed, same bots, same faces-from-seed: the table adds nothing.
        expect(outcome).toEqual(headless.outcome);
        expect(session.getSnapshot().log).toEqual(headless.log);
        expect(
            replayGame(rules, ['north', 'south'], createSeededRng(2024), [
                ...session.getSnapshot().log,
            ])
        ).toEqual(session.getSnapshot().state);
        expect(session.getSnapshot().phase).toBe('over');
        // A finished game no longer owns the table: R must mean R again.
        expect(session.isActive()).toBe(false);
    });

    it('never throws a die the rules have set aside, and the jail mirrors the rules state', async () => {
        const table = fakeTable();
        const session = build(table, [
            { id: 'north', name: 'North', bot: true },
            { id: 'south', name: 'South', bot: true },
        ]);
        const seen: FarkleState[] = [];
        session.subscribe((snap) => seen.push(snap.state));
        await session.start();

        expect(table.throws.length).toBeGreaterThan(5);
        for (const t of table.throws) {
            expect(t.ids.length).toBeGreaterThan(0);
            for (const id of t.ids) expect(t.held).not.toContain(id);
        }
        // After every state the session published, the jail held exactly the kept dice.
        const final = session.getSnapshot().state;
        const keptNow = final.dice.filter((d) => d.kept).map((d) => BASE_ID + d.id);
        expect(table.heldIds()).toEqual(keptNow.sort((a, b) => a - b));
    });

    it('locks the jail while a game owns it and unlocks it on stop', async () => {
        const table = fakeTable();
        const session = build(table, [
            { id: 'a', name: 'A', bot: true },
            { id: 'b', name: 'B', bot: true },
        ]);
        await session.start();
        expect(table.locked).not.toBeNull();
        await session.stop();
        expect(table.locked).toBeNull();
        expect(table.restored).toBe(1);
        expect(table.heldIds()).toEqual([]);
    });
});

describe('GameSession — a person at the table', () => {
    it('plays throw → set aside → bank, and the score moves only through Farkle.apply', async () => {
        const table = fakeTable();
        const rules = createFarkleRules({ targetScore: 300, maxRounds: 3 });
        const session = build(
            table,
            [
                { id: 'you', name: 'You' },
                { id: 'bot', name: 'Bot', bot: true },
            ],
            7,
            rules
        );
        const finished = session.start();

        let guard = 0;
        while (session.getSnapshot().phase !== 'over' && guard++ < 400) {
            const snap = await Promise.race([until(session, 'your-turn'), until(session, 'over')]);
            if (snap.phase === 'over') break;
            expect(snap.toAct).toBe('you');
            const before = snap.state;

            // Whatever the panel previews is what the rules then do.
            const act = (action: FarkleAction) => {
                const preview = session.preview(action);
                const result = session.submit(action);
                expect(result).toEqual({ ok: true });
                return preview;
            };

            if (before.phase === 'roll') act({ type: 'roll' });
            else if (before.phase === 'keep') {
                const keep = biggestKeep(snap);
                const preview = act(keep);
                if (preview.ok && keep.type === 'keep') {
                    const values = keep.dice.map((id) => before.dice[id]!.value!);
                    expect(preview.state.turnScore).toBe(
                        before.turnScore + scoreFarkleKeep(values)!
                    );
                }
            } else act(before.turnScore >= 300 ? { type: 'bank' } : { type: 'roll' });
            // let the turn play out until the next time it is ours
            await new Promise((r) => setTimeout(r, 0));
        }
        const outcome = await finished;

        expect(outcome).not.toBeNull();
        const final = session.getSnapshot();
        // The whole game, human actions included, replays from its log alone.
        expect(replayGame(rules, ['you', 'bot'], createSeededRng(7), [...final.log])).toEqual(
            final.state
        );
        // The panel never held a score of its own: the only thing that changed
        // totals is a logged bank.
        const banked: Record<string, number> = { you: 0, bot: 0 };
        let turn = 0;
        let replay = rules.init(['you', 'bot'], createSeededRng(7));
        for (const entry of final.log) {
            replay = rules.apply(replay, entry.action, entry.roll);
            if (entry.action.type === 'bank') banked[entry.seat] = replay.scores[entry.seat]!;
            turn += 1;
        }
        expect(turn).toBe(final.log.length);
        expect(final.state.scores).toEqual(outcome!.scores);
    });

    it('only offers the human their own turn, and rejects an action that is not legal', async () => {
        const table = fakeTable();
        const session = build(table, [
            { id: 'you', name: 'You' },
            { id: 'bot', name: 'Bot', bot: true },
        ]);
        // Nothing to act on before the game starts.
        expect(session.submit({ type: 'roll' })).toMatchObject({ ok: false });

        void session.start();
        const snap = await until(session, 'your-turn');
        expect(snap.legal).toEqual([{ type: 'roll' }]);

        // Wrong phase: bank before a throw.
        expect(session.submit({ type: 'bank' })).toMatchObject({ ok: false });
        expect(session.getSnapshot().state).toBe(snap.state);

        expect(session.submit({ type: 'roll' })).toEqual({ ok: true });
        const keep = await until(session, 'your-turn');
        expect(keep.state.phase).toBe('keep');

        // A die that does not score cannot be set aside, and nothing is held.
        const nonScoring = keep.state.dice.find((d) => d.value !== 1 && d.value !== 5);
        if (nonScoring) {
            const refused = session.submit({ type: 'keep', dice: [nonScoring.id] });
            expect(refused).toMatchObject({ ok: false });
            expect(table.heldIds()).toEqual([]);
        }
        // Rolling again before setting aside is not allowed either.
        expect(session.submit({ type: 'roll' })).toMatchObject({ ok: false });
        await session.stop();
    });

    it('setting aside holds exactly those dice in the jail, and the next throw leaves them alone', async () => {
        const table = fakeTable();
        const session = build(table, [
            { id: 'you', name: 'You' },
            { id: 'bot', name: 'Bot', bot: true },
        ]);
        void session.start();
        await until(session, 'your-turn');
        session.submit({ type: 'roll' });
        const keepSnap = await until(session, 'your-turn');
        const keep = biggestKeep(keepSnap);
        if (keep.type !== 'keep') throw new Error('expected a keep');
        const kept = keep.dice.map((id) => BASE_ID + id).sort((a, b) => a - b);
        session.submit(keep);
        const decide = await until(session, 'your-turn');
        expect(decide.state.phase).toBe('decide');
        expect(table.heldIds()).toEqual(kept);

        if (keep.dice.length < FARKLE_DICE) {
            session.submit({ type: 'roll' });
            await until(session, 'your-turn');
            const second = table.throws[1]!;
            for (const id of kept) {
                expect(second.ids).not.toContain(id);
                expect(second.held).toContain(id);
            }
            expect(second.ids).toHaveLength(FARKLE_DICE - keep.dice.length);
        }
        await session.stop();
    });

    it('offers a re-throw for a cocked die and applies only the clean throw', async () => {
        const table = fakeTable();
        // First throw: the first die is cocked (reads a face, but flagged).
        table.next.push((ids) => ({ cocked: [ids[0]!], timedOut: true, reason: 'simTimeout' }));
        const session = build(table, [
            { id: 'you', name: 'You' },
            { id: 'bot', name: 'Bot', bot: true },
        ]);
        void session.start();
        await until(session, 'your-turn');
        session.submit({ type: 'roll' });

        const cocked = await until(session, 'cocked');
        expect(cocked.throwing?.cocked).toEqual([0]);
        // Nothing was applied: the rules never saw the cocked faces.
        expect(session.getSnapshot().log).toHaveLength(0);
        expect(session.submit({ type: 'roll' })).toMatchObject({ ok: false });

        expect(session.rethrow()).toEqual({ ok: true });
        await Promise.race([until(session, 'your-turn'), until(session, 'bot-turn')]);

        expect(table.throws).toHaveLength(2);
        // A new seed, the same dice.
        expect(table.throws[1]!.seed).not.toBe(table.throws[0]!.seed);
        expect(table.throws[1]!.ids).toEqual(table.throws[0]!.ids);
        const log = session.getSnapshot().log;
        expect(log).toHaveLength(1);
        expect(log[0]!.roll!.seed).toBe(table.throws[1]!.seed);
        await session.stop();
    });

    it("re-throws a bot's cocked throw by itself, then gives up rather than loop", async () => {
        const table = fakeTable();
        const stuck = (ids: number[]) => ({ cocked: [ids[0]!], timedOut: true });
        for (let i = 0; i < 10; i++) table.next.push(stuck);
        const session = build(table, [
            { id: 'a', name: 'A', bot: true },
            { id: 'b', name: 'B', bot: true },
        ]);
        await session.start();
        const snap = session.getSnapshot();
        expect(snap.phase).toBe('stopped');
        expect(snap.notice).toMatch(/would not settle/);
        // 1 throw + maxAutoRethrows (3) re-throws + the one that tipped it over.
        expect(table.throws.length).toBeLessThanOrEqual(5);
        expect(table.restored).toBe(1);
    });

    it('ends the game cleanly if the dice on the table are changed under it', async () => {
        const table = fakeTable();
        const session = build(table, [
            { id: 'you', name: 'You' },
            { id: 'bot', name: 'Bot', bot: true },
        ]);
        const finished = session.start();
        await until(session, 'your-turn');
        table.gone = true;
        session.submit({ type: 'roll' });
        expect(await finished).toBeNull();
        expect(session.getSnapshot()).toMatchObject({ phase: 'stopped' });
        expect(session.getSnapshot().notice).toMatch(/dice on the table changed/);
        expect(table.throws).toHaveLength(0);
        expect(table.locked).toBeNull();
    });

    it('stop() mid-game releases the jail, restores the table and unblocks the loop', async () => {
        const table = fakeTable();
        const session = build(table, [
            { id: 'you', name: 'You' },
            { id: 'bot', name: 'Bot', bot: true },
        ]);
        const finished = session.start();
        await until(session, 'your-turn');
        session.submit({ type: 'roll' });
        await until(session, 'your-turn');
        await session.stop('Closed.');
        expect(await finished).toBeNull();
        expect(table.heldIds()).toEqual([]);
        expect(table.restored).toBe(1);
        expect(session.isActive()).toBe(false);
        // Idempotent.
        await session.stop();
        expect(table.restored).toBe(1);
    });

    it('seats the table once and throws only dice the rules named', async () => {
        const table = fakeTable();
        const seatSpy = vi.spyOn(table, 'seat');
        const session = build(table, [
            { id: 'a', name: 'A', bot: true },
            { id: 'b', name: 'B', bot: true },
        ]);
        await session.start();
        expect(seatSpy).toHaveBeenCalledTimes(1);
        expect(seatSpy).toHaveBeenCalledWith(FARKLE_DIE_SET);
        for (const t of table.throws) {
            for (const id of t.ids) {
                expect(id).toBeGreaterThanOrEqual(BASE_ID);
                expect(id).toBeLessThan(BASE_ID + FARKLE_DICE);
            }
        }
    });
});
