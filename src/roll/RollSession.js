/**
 * Roll orchestration: spawn dice from notation, throw, wait for settlement,
 * evaluate keep/drop/modifiers, and handle exploding / one-shot rerolls.
 */

import {
    parseNotation,
    buildSpawnSpecsForGroups,
    evaluateRoll,
    getExplodingRespawnSpecs,
    getRerollRespawnSpecs,
    DEFAULT_ROLL_SYSTEM,
    NotationError
} from './Notation.js';

/**
 * @typedef {Object} DieSpec
 * @property {string} type
 * @property {'tens'|'ones'|null} role
 * @property {number} groupIndex
 * @property {number} dieIndex
 * @property {boolean} explode
 * @property {number} sides
 * @property {number|null} [rerollMax]
 * @property {number} [replacesDieIndex]
 * @property {boolean} [isReroll]
 */

/**
 * @typedef {Object} RollSessionDeps
 * @property {object} scene
 * @property {object} world
 * @property {(scene: object, world: object, specs: DieSpec[]) => void} replaceDiceSet
 * @property {(scene: object, world: object, seed?: number|null) => void} throwDice
 * @property {() => Array<{type: string, value: number|null, role?: string|null, groupIndex?: number}>} readAllDiceValues
 * @property {() => boolean} areDiceSettled
 * @property {(ms?: number) => Promise<void>} [waitFrame]
 * @property {(active: boolean) => void} [setDeferAutoResults]
 * @property {(result: import('./Notation.js').EvaluatedRoll) => void} [onComplete]
 * @property {(state: string) => void} [onStateChange]
 * @property {() => string} [getSystem]
 */

let activeSession = null;
let deferAutoResults = false;

/** @returns {boolean} */
export function isNotationRollActive() {
    return activeSession !== null;
}

/** @returns {boolean} */
export function shouldDeferAutoResults() {
    return deferAutoResults;
}

/**
 * @param {RollSessionDeps} deps
 */
export function createRollSession(deps) {
    const waitFrame = deps.waitFrame ?? (() => new Promise((r) => requestAnimationFrame(r)));

    /**
     * @param {string} expression
     * @param {number|null} [seed]
     * @param {{ system?: string }} [options]
     */
    async function roll(expression, seed = null, options = {}) {
        if (activeSession) {
            throw new NotationError('A notation roll is already in progress');
        }

        const parsed = parseNotation(expression);
        const system = options.system
            ?? deps.getSystem?.()
            ?? DEFAULT_ROLL_SYSTEM;

        activeSession = { expression: parsed.raw, seed, system };
        deferAutoResults = true;
        deps.setDeferAutoResults?.(true);
        deps.onStateChange?.('parsing');

        try {
            const leftSide = { groups: parsed.groups, modifier: parsed.modifier, raw: parsed.raw };
            const leftDice = await resolveSide(deps, leftSide, seed, waitFrame);

            let opposedDice = null;
            if (parsed.opposed) {
                const rightSeed = seed != null ? (seed + 0x9E3779B9) >>> 0 : null;
                opposedDice = await resolveSide(deps, parsed.opposed, rightSeed, waitFrame);
            }

            deps.onStateChange?.('evaluating');
            const result = evaluateRoll(parsed, leftDice, {
                opposedDice: opposedDice ?? undefined,
                seed: seed != null ? seed >>> 0 : null,
                system
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

/**
 * @param {RollSessionDeps} deps
 * @param {{ groups: import('./Notation.js').DiceGroup[], modifier: number, raw: string }} side
 * @param {number|null} seed
 * @param {(ms?: number) => Promise<void>} waitFrame
 */
async function resolveSide(deps, side, seed, waitFrame) {
    let specs = buildSpawnSpecsForGroups(side.groups);
    let subSeed = seed;
    let accumulatedDice = [];
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
        const roundDice = raw.map((r, i) => ({
            groupIndex: specs[i]?.groupIndex ?? 0,
            dieIndex: specs[i]?.dieIndex ?? i,
            type: r.type,
            value: r.value,
            role: specs[i]?.role ?? r.role ?? null,
            exploded: Boolean(specs[i]?.replacesDieIndex != null && !specs[i]?.isReroll),
            rerolled: Boolean(specs[i]?.isReroll)
        }));

        if (explosionRound === 0 && !didRerollPass) {
            accumulatedDice = roundDice;
        } else if (specs.some((s) => s.isReroll)) {
            // One-shot reroll: mark prior slot values as replaced, append new readings.
            roundDice.forEach((d, i) => {
                const slot = specs[i]?.dieIndex ?? d.dieIndex;
                accumulatedDice.forEach((prev) => {
                    if (prev.groupIndex === d.groupIndex && prev.dieIndex === slot && !prev.exploded) {
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
                    originalValue: accumulatedDice.find(
                        (p) => p.groupIndex === d.groupIndex && p.dieIndex === slot && p.replacedByReroll
                    )?.originalValue ?? null
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
                    exploded: true
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

/**
 * @param {() => boolean} areDiceSettled
 * @param {(ms?: number) => Promise<void>} waitFrame
 */
async function waitForSettled(areDiceSettled, waitFrame) {
    let idleFrames = 0;
    while (idleFrames < 3) {
        await waitFrame();
        if (areDiceSettled()) idleFrames += 1;
        else idleFrames = 0;
    }
}

export { NotationError, parseNotation };
export { formatGroupLabel, DEFAULT_ROLL_SYSTEM } from './Notation.js';
