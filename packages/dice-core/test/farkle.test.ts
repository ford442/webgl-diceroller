/**
 * Farkle rules (GameRules slice 1): the scoring table, the turn state machine,
 * and property tests over random legal play — the turn score only grows until
 * the turn ends, a bust zeroes it, every game terminates, and a game replays
 * from its action log alone.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
    IllegalActionError,
    bestFarkleScore,
    createFarkleBot,
    createFarkleRules,
    createRngRoller,
    createSeededRng,
    farkleRollStats,
    playGame,
    replayGame,
    scoreFarkleKeep,
    type ActionLogEntry,
    type FarkleAction,
    type FarkleState,
    type GamePolicy,
} from 'dice-core';

const roller = createRngRoller(createSeededRng);

describe('scoreFarkleKeep', () => {
    it.each([
        [[1], 100],
        [[5], 50],
        [[1, 5], 150],
        [[1, 1, 1], 1000],
        [[2, 2, 2], 200],
        [[6, 6, 6], 600],
        [[2, 2, 2, 2], 400],
        [[2, 2, 2, 2, 2], 800],
        [[2, 2, 2, 2, 2, 2], 1600],
        [[1, 1, 1, 1], 2000],
        [[5, 5, 5, 5, 5], 2000],
        [[3, 3, 3, 1, 5], 450],
        [[1, 2, 3, 4, 5, 6], 1500],
        [[2, 2, 3, 3, 4, 4], 1500],
        [[2, 2, 2, 2, 3, 3], 1500],
        [[1, 1, 1, 1, 5, 5], 2100],
    ])('%j scores %i', (values, score) => {
        expect(scoreFarkleKeep(values)).toBe(score);
    });

    it.each([[[]], [[2]], [[1, 2]], [[3, 3]], [[1, 2, 3, 4, 5]], [[2, 2, 3, 3]]])(
        '%j is not a keep',
        (values) => {
            expect(scoreFarkleKeep(values)).toBeNull();
        }
    );

    it('rejects a non-d6 face', () => {
        expect(() => scoreFarkleKeep([7])).toThrow(IllegalActionError);
    });

    it('bestFarkleScore ignores dead dice, and is 0 only for a bust', () => {
        expect(bestFarkleScore([1, 2, 3, 4, 6, 6])).toBe(100);
        expect(bestFarkleScore([2, 3, 4, 6, 6, 2])).toBe(0);
        expect(bestFarkleScore([2, 2, 2, 3])).toBe(200);
    });

    it('any keep scores no more than the best of its throw', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 1, maxLength: 6 }),
                fc.integer({ min: 1, max: 63 }),
                (faces, mask) => {
                    const subset = faces.filter((_, i) => mask & (1 << i));
                    const s = scoreFarkleKeep(subset);
                    if (s !== null) expect(s).toBeLessThanOrEqual(bestFarkleScore(faces));
                }
            )
        );
    });
});

describe('farkleRollStats', () => {
    it('matches the known bust odds', () => {
        expect(farkleRollStats(1).bustChance).toBeCloseTo(2 / 3, 10);
        expect(farkleRollStats(2).bustChance).toBeCloseTo(16 / 36, 10);
        expect(farkleRollStats(6).bustChance).toBeCloseTo(0.0231, 3);
        for (let n = 2; n <= 6; n++) {
            expect(farkleRollStats(n).bustChance).toBeLessThan(farkleRollStats(n - 1).bustChance);
        }
    });
});

describe('Farkle turn', () => {
    const rules = createFarkleRules();
    const start = () => rules.init(['a', 'b'], createSeededRng(1));
    const roll = (state: FarkleState, faces: number[]) =>
        rules.apply(state, { type: 'roll' }, { faces, seed: null });

    it('starts with seat a throwing six dice', () => {
        const s = start();
        expect(rules.toAct(s)).toBe('a');
        expect(rules.legalActions(s, 'a')).toEqual([{ type: 'roll' }]);
        expect(rules.legalActions(s, 'b')).toEqual([]);
        expect(rules.throwFor(s, { type: 'roll' })?.dice).toHaveLength(6);
    });

    it('keeps, throws the rest, then banks', () => {
        let s = roll(start(), [1, 2, 3, 4, 6, 6]);
        expect(s.phase).toBe('keep');
        expect(rules.legalActions(s, 'a')).toEqual([{ type: 'keep', dice: [0] }]);
        s = rules.apply(s, { type: 'keep', dice: [0] });
        expect(s.turnScore).toBe(100);
        expect(rules.throwFor(s, { type: 'roll' })?.dice.map((d) => d.id)).toEqual([1, 2, 3, 4, 5]);
        s = roll(s, [5, 5, 5, 2, 3]);
        s = rules.apply(s, { type: 'keep', dice: [1, 2, 3] });
        expect(s.turnScore).toBe(600);
        s = rules.apply(s, { type: 'bank' });
        expect(s.scores).toEqual({ a: 600, b: 0 });
        expect(rules.toAct(s)).toBe('b');
        expect(s.lastTurn).toEqual({ seat: 'a', result: 'bank', points: 600, faces: [] });
    });

    it('a bust loses the turn score', () => {
        let s = roll(start(), [1, 2, 3, 4, 6, 6]);
        s = rules.apply(s, { type: 'keep', dice: [0] });
        s = roll(s, [2, 3, 4, 6, 6]);
        expect(s.scores).toEqual({ a: 0, b: 0 });
        expect(s.turnScore).toBe(0);
        expect(s.lastTurn?.result).toBe('bust');
        expect(rules.toAct(s)).toBe('b');
    });

    it('hot dice frees all six', () => {
        let s = roll(start(), [1, 1, 1, 5, 5, 5]);
        s = rules.apply(s, { type: 'keep', dice: [0, 1, 2, 3, 4, 5] });
        expect(s.turnScore).toBe(1500);
        expect(s.dice.every((d) => !d.kept)).toBe(true);
        expect(rules.throwFor(s, { type: 'roll' })?.dice).toHaveLength(6);
    });

    it('rejects illegal actions without changing state', () => {
        const s = roll(start(), [1, 2, 3, 4, 6, 6]);
        expect(() => rules.apply(s, { type: 'keep', dice: [1] })).toThrow(IllegalActionError);
        expect(() => rules.apply(s, { type: 'keep', dice: [] })).toThrow(IllegalActionError);
        expect(() => rules.apply(s, { type: 'bank' })).toThrow(IllegalActionError);
        expect(() => rules.apply(start(), { type: 'roll' })).toThrow(IllegalActionError);
        expect(() =>
            rules.apply(start(), { type: 'roll' }, { faces: [1, 2, 3], seed: null })
        ).toThrow(IllegalActionError);
        expect(s.phase).toBe('keep');
    });

    it('reaching the target gives every other seat one last turn', () => {
        const short = createFarkleRules({ targetScore: 500 });
        let s = short.init(['a', 'b', 'c'], createSeededRng(1));
        s = short.apply(s, { type: 'roll' }, { faces: [5, 5, 5, 2, 3, 4], seed: null });
        s = short.apply(s, { type: 'keep', dice: [0, 1, 2] });
        s = short.apply(s, { type: 'bank' });
        expect(s.finalTurnsLeft).toBe(2);
        for (const seat of ['b', 'c']) {
            expect(short.outcome(s)).toBeNull();
            expect(short.toAct(s)).toBe(seat);
            s = short.apply(s, { type: 'roll' }, { faces: [2, 3, 4, 6, 6, 2], seed: null });
        }
        expect(short.outcome(s)).toEqual({
            winners: ['a'],
            scores: { a: 500, b: 0, c: 0 },
            reason: 'target',
        });
    });
});

/** A legal-action policy driven by its own seeded stream. */
function randomPolicy(seed: number): GamePolicy<FarkleAction, FarkleState> {
    const rng = createSeededRng(seed);
    return (_view, legal) => legal[Math.floor(rng() * legal.length)] ?? legal[0]!;
}

describe('Farkle property tests', () => {
    it('random legal play: monotone turn score, busts zero it, games end and replay', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 0xffffffff }),
                fc.integer({ min: 1, max: 4 }),
                fc.integer({ min: 300, max: 3000 }),
                async (seed, seatCount, targetScore) => {
                    const rules = createFarkleRules({ targetScore, maxRounds: 40 });
                    const seats = Array.from({ length: seatCount }, (_, i) => `s${i}`);
                    const policies = Object.fromEntries(
                        seats.map((s, i) => [s, randomPolicy(seed + i)])
                    );
                    const played = await playGame({
                        rules,
                        seats,
                        seed,
                        policies,
                        roller,
                        createRng: createSeededRng,
                        maxActions: 20_000,
                    });
                    expect(played.outcome.winners.length).toBeGreaterThan(0);

                    // Walk the log: the turn score never drops mid-turn, and the
                    // only score that changes at a turn end is the banking seat's.
                    let state = rules.init(seats, createSeededRng(seed));
                    let banked = 0;
                    for (const entry of played.log as ActionLogEntry<FarkleAction>[]) {
                        const before = state;
                        state = rules.apply(state, entry.action, entry.roll);
                        const turnEnded = state.lastTurn !== before.lastTurn;
                        if (!turnEnded) {
                            expect(state.turnScore).toBeGreaterThanOrEqual(before.turnScore);
                            continue;
                        }
                        expect(state.turnScore).toBe(0);
                        const t = state.lastTurn!;
                        for (const s of seats) {
                            const delta = state.scores[s]! - before.scores[s]!;
                            expect(delta).toBe(s === t.seat ? t.points : 0);
                        }
                        if (t.result === 'bust') expect(t.points).toBe(0);
                        else expect(t.points).toBe(before.turnScore);
                        banked += t.points;
                    }
                    const total = seats.reduce((sum, s) => sum + played.state.scores[s]!, 0);
                    expect(total).toBe(banked);
                    expect(played.state.round).toBeLessThanOrEqual(41);

                    const replayed = replayGame(rules, seats, createSeededRng(seed), played.log);
                    expect(replayed).toEqual(played.state);
                }
            ),
            { numRuns: 60 }
        );
    });

    it('every offered keep is accepted', () => {
        const rules = createFarkleRules();
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 6, maxLength: 6 }),
                (faces) => {
                    const s = rules.apply(
                        rules.init(['a'], createSeededRng(1)),
                        { type: 'roll' },
                        { faces, seed: null }
                    );
                    if (s.phase !== 'keep') {
                        expect(bestFarkleScore(faces)).toBe(0);
                        return;
                    }
                    for (const action of rules.legalActions(s, 'a')) {
                        const next = rules.apply(s, action);
                        expect(next.turnScore).toBeGreaterThan(0);
                    }
                }
            )
        );
    });
});

describe('Farkle bot', () => {
    it('two bots play a full game to 10 000 deterministically', async () => {
        const rules = createFarkleRules();
        const bot = createFarkleBot();
        const play = () =>
            playGame({
                rules,
                seats: ['north', 'south'],
                seed: 2024,
                policies: { north: bot, south: bot },
                roller,
                createRng: createSeededRng,
            });
        const a = await play();
        const b = await play();
        expect(a.outcome.reason).toBe('target');
        expect(Math.max(...Object.values(a.outcome.scores))).toBeGreaterThanOrEqual(10_000);
        expect(b.log).toEqual(a.log);
    });

    it('beats a random player most of the time', async () => {
        const rules = createFarkleRules({ targetScore: 3000 });
        let wins = 0;
        for (let seed = 1; seed <= 40; seed++) {
            const { outcome } = await playGame({
                rules,
                seats: ['bot', 'random'],
                seed,
                policies: { bot: createFarkleBot(), random: randomPolicy(seed) },
                roller,
                createRng: createSeededRng,
            });
            if (outcome.winners.length === 1 && outcome.winners[0] === 'bot') wins += 1;
        }
        expect(wins).toBeGreaterThanOrEqual(30);
    });

    it('chases the leader in the final round', () => {
        const rules = createFarkleRules({ targetScore: 1000 });
        const bot = createFarkleBot();
        const s: FarkleState = {
            ...rules.init(['a', 'b'], createSeededRng(1)),
            current: 1,
            phase: 'decide',
            scores: { a: 1200, b: 900 },
            turnScore: 200,
            finalTurnsLeft: 1,
        };
        // 900 + 200 < 1200: banking loses, so it throws again.
        expect(bot(s, rules.legalActions(s, 'b'), 'b')).toEqual({ type: 'roll' });
        const ahead = { ...s, turnScore: 400 };
        expect(bot(ahead, rules.legalActions(ahead, 'b'), 'b')).toEqual({ type: 'bank' });
    });
});
