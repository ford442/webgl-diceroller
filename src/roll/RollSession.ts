/**
 * Roll orchestration: spawn dice from notation, throw, wait for settlement,
 * evaluate keep/drop/modifiers, and handle exploding / one-shot rerolls.
 */

import type { EvaluatedRoll, RollSessionDeps as BaseRollSessionDeps } from '../types/roll.js';
import {
    parseNotation,
    buildSpawnSpecsForGroups,
    evaluateRoll,
    getExplodingRespawnSpecs,
    getRerollRespawnSpecs,
    DEFAULT_ROLL_SYSTEM,
    NotationError,
} from './Notation.js';
import type { DiceGroup, DieOutcome, ParsedSide, SpawnDieSpec } from './Notation.js';

export interface RollSessionDeps extends BaseRollSessionDeps {
    getSystem?: () => string;
}

interface ActiveSession {
    expression: string;
    seed: number | null;
    system: string;
}

let activeSession: ActiveSession | null = null;
let deferAutoResults = false;

export function isNotationRollActive(): boolean {
    return activeSession !== null;
}

export function shouldDeferAutoResults(): boolean {
    return deferAutoResults;
}

export function createRollSession(deps: RollSessionDeps) {
    const waitFrame = deps.waitFrame ?? (() => new Promise<void>((r) => requestAnimationFrame(() => r())));

    async function roll(
        expression: string,
        seed: number | null = null,
        options: { system?: string } = {}
    ): Promise<EvaluatedRoll> {
        if (activeSession) {
            throw new NotationError('A notation roll is already in progress');
        }

        const parsed = parseNotation(expression);
        const system = options.system ?? deps.getSystem?.() ?? DEFAULT_ROLL_SYSTEM;

        activeSession = { expression: parsed.raw, seed, system };
        deferAutoResults = true;
        deps.setDeferAutoResults?.(true);
        deps.onStateChange?.('parsing');

        try {
            const leftSide: ParsedSide = {
                groups: parsed.groups,
                modifier: parsed.modifier,
                raw: parsed.raw,
            };
            const leftDice = await resolveSide(deps, leftSide, seed, waitFrame);

            let opposedDice: DieOutcome[] | null = null;
            if (parsed.opposed) {
                const rightSeed = seed != null ? (seed + 0x9e3779b9) >>> 0 : null;
                opposedDice = await resolveSide(deps, parsed.opposed, rightSeed, waitFrame);
            }

            deps.onStateChange?.('evaluating');
            const result = evaluateRoll(parsed, leftDice, {
                opposedDice: opposedDice ?? undefined,
                seed: seed != null ? seed >>> 0 : null,
                system,
            });
            deps.onComplete?.(result);
            return result;
        } finally {
            activeSession = null;
            deferAutoResults = false;
            deps.setDeferAutoResults?.(false);
            deps.onStateChange?.('idle');
        }
    }

    return { roll };
}

async function resolveSide(
    deps: RollSessionDeps,
    side: { groups: DiceGroup[]; modifier: number; raw: string },
    seed: number | null,
    waitFrame: (ms?: number) => Promise<void>
): Promise<DieOutcome[]> {
    let specs: SpawnDieSpec[] = buildSpawnSpecsForGroups(side.groups);
    let subSeed = seed;
    let accumulatedDice: DieOutcome[] = [];
    let explosionRound = 0;
    const maxExplosionRounds = 20;
    let didRerollPass = false;

    while (true) {
        deps.onStateChange?.(explosionRound === 0 && !didRerollPass ? 'spawning' : 'respawning');
        deps.replaceDiceSet(deps.scene, deps.world, specs);

        deps.onStateChange?.('throwing');
        deps.throwDice(deps.scene, deps.world, subSeed);
        subSeed = subSeed != null ? (subSeed + 1) >>> 0 : null;

        deps.onStateChange?.('waiting');
        await waitForSettled(deps.areDiceSettled, waitFrame);

        const raw = deps.readAllDiceValues();
        const roundDice: DieOutcome[] = raw.map((r, i) => ({
            groupIndex: specs[i]?.groupIndex ?? 0,
            dieIndex: specs[i]?.dieIndex ?? i,
            type: r.type,
            value: r.value,
            role: specs[i]?.role ?? (r.role as DieOutcome['role']) ?? null,
            exploded: Boolean(specs[i]?.replacesDieIndex != null && !specs[i]?.isReroll),
            rerolled: Boolean(specs[i]?.isReroll),
        }));

        if (explosionRound === 0 && !didRerollPass) {
            accumulatedDice = roundDice;
        } else if (specs.some((s) => s.isReroll)) {
            // One-shot reroll: mark prior slot values as replaced, append new readings.
            roundDice.forEach((d, i) => {
                const slot = specs[i]?.dieIndex ?? d.dieIndex;
                accumulatedDice.forEach((prev) => {
                    if (
                        prev.groupIndex === d.groupIndex &&
                        prev.dieIndex === slot &&
                        !prev.exploded
                    ) {
                        prev.replacedByReroll = true;
                        prev.kept = false;
                        prev.dropped = true;
                        prev.originalValue = prev.value;
                    }
                });
                accumulatedDice.push({
                    ...d,
                    dieIndex: slot,
                    rerolled: true,
                    originalValue:
                        accumulatedDice.find(
                            (p) =>
                                p.groupIndex === d.groupIndex &&
                                p.dieIndex === slot &&
                                p.replacedByReroll
                        )?.originalValue ?? null,
                });
            });
            didRerollPass = true;
        } else {
            // Explode merge — keep the same dieIndex so slot totals compound correctly.
            roundDice.forEach((d, i) => {
                const slot = specs[i]?.dieIndex ?? d.dieIndex;
                accumulatedDice.push({
                    ...d,
                    dieIndex: slot,
                    exploded: true,
                });
            });
        }

        // Reroll once before explosions (only on the initial pool).
        if (!didRerollPass && explosionRound === 0) {
            const rerollSpecs = getRerollRespawnSpecs(side, accumulatedDice);
            if (rerollSpecs.length) {
                specs = rerollSpecs;
                continue;
            }
            didRerollPass = true;
        }

        const explodeSpecs = getExplodingRespawnSpecs(side, roundDice);
        if (!explodeSpecs.length || explosionRound >= maxExplosionRounds) break;

        specs = explodeSpecs;
        explosionRound += 1;
    }

    return accumulatedDice;
}

async function waitForSettled(
    areDiceSettled: () => boolean,
    waitFrame: (ms?: number) => Promise<void>
): Promise<void> {
    let idleFrames = 0;
    while (idleFrames < 3) {
        await waitFrame();
        if (areDiceSettled()) idleFrames += 1;
        else idleFrames = 0;
    }
}

export { NotationError, parseNotation };
export { formatGroupLabel, DEFAULT_ROLL_SYSTEM } from './Notation.js';
