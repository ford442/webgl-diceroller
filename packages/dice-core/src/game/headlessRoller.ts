/**
 * A `GameRoller` backed by the real solver: each throw is a `rollHeadless()`
 * of the requested dice, so a bot-vs-bot game in Node (or CI) plays on the
 * same physics as the tavern table.
 */

import type { GameRoller, ThrowRequest } from './GameRules.js';
import { rollHeadless, type RollHeadlessOptions } from '../rollHeadless.js';

/** `2d6+1d20`, grouping the request's types in first-seen order. */
function throwExpression(request: ThrowRequest): { expression: string; types: string[] } {
    const types: string[] = [];
    const counts = new Map<string, number>();
    for (const { type } of request.dice) {
        if (!counts.has(type)) types.push(type);
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const expression = types.map((t) => `${counts.get(t)}${t}`).join('+');
    return { expression, types };
}

export function createHeadlessRoller(options: RollHeadlessOptions = {}): GameRoller {
    return async (request, seed) => {
        if (!request.dice.length) return { faces: [], seed };
        const { expression, types } = throwExpression(request);
        const rolled = await rollHeadless(expression, seed, null, options);
        // Group g, die k comes back as the k-th die of type types[g].
        const byType = new Map<string, number[]>(types.map((t) => [t, []]));
        const ordered = [...rolled.results].sort(
            (a, b) => a.groupIndex - b.groupIndex || a.dieIndex - b.dieIndex
        );
        for (const die of ordered) byType.get(types[die.groupIndex] ?? '')?.push(die.value);
        const faces = request.dice.map(({ type }) => {
            const face = byType.get(type)?.shift();
            if (face === undefined) throw new Error(`Headless roller: no face for a ${type}.`);
            return face;
        });
        return { faces, seed };
    };
}
