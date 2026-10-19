/**
 * Bot-vs-bot Farkle on the real solver: every throw is a rollHeadless() of the
 * free dice. The game must reach an outcome well inside CI's 30 s budget and
 * replay from its action log without physics.
 */
import { expect, it } from 'vitest';
import {
    createFarkleBot,
    createFarkleRules,
    createHeadlessRoller,
    createSeededRng,
    playGame,
    replayGame,
} from 'dice-core';
import { describeWasm } from './wasmGate.js';

describeWasm('Farkle on headless physics', () => {
    it('two bots play a full game to 10 000 in under 30 s', { timeout: 60_000 }, async () => {
        const rules = createFarkleRules();
        const bot = createFarkleBot();
        const seats = ['north', 'south'];
        const started = performance.now();
        const played = await playGame({
            rules,
            seats,
            seed: 31337,
            policies: { north: bot, south: bot },
            roller: createHeadlessRoller(),
            createRng: createSeededRng,
        });
        const elapsed = performance.now() - started;

        expect(played.outcome.reason).toBe('target');
        expect(elapsed).toBeLessThan(30_000);
        const throws = played.log.filter((e) => e.roll);
        expect(throws.length).toBeGreaterThan(0);
        for (const { roll } of throws) {
            expect(roll!.faces.every((f) => f >= 1 && f <= 6)).toBe(true);
        }
        expect(replayGame(rules, seats, createSeededRng(31337), played.log)).toEqual(played.state);
    });
});
