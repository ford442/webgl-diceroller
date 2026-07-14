/**
 * Roll orchestration: spawn dice from notation, throw, wait for settlement,
 * evaluate keep/drop/modifiers, and handle exploding re-rolls.
 */

import {
    parseNotation,
    buildSpawnSpecs,
    evaluateRoll,
    getExplodingRespawnSpecs,
    formatGroupLabel,
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
 * @property {number} [replacesDieIndex]
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
     */
    async function roll(expression, seed = null) {
        if (activeSession) {
            throw new NotationError('A notation roll is already in progress');
        }

        const parsed = parseNotation(expression);
        activeSession = { expression: parsed.raw };
        deferAutoResults = true;
        deps.setDeferAutoResults?.(true);
        deps.onStateChange?.('parsing');

        try {
            let specs = buildSpawnSpecs(parsed);
            let subSeed = seed;
            let accumulatedDice = [];
            let explosionRound = 0;
            const maxExplosionRounds = 20;

            while (true) {
                deps.onStateChange?.(explosionRound === 0 ? 'spawning' : 'respawning');
                deps.replaceDiceSet(deps.scene, deps.world, specs);

                deps.onStateChange?.('throwing');
                deps.throwDice(deps.scene, deps.world, subSeed);
                subSeed = subSeed != null ? subSeed + 1 : null;

                deps.onStateChange?.('waiting');
                await waitForSettled(deps.areDiceSettled, waitFrame);

                const raw = deps.readAllDiceValues();
                const roundDice = raw.map((r, i) => ({
                    groupIndex: specs[i]?.groupIndex ?? 0,
                    dieIndex: specs[i]?.dieIndex ?? i,
                    type: r.type,
                    value: r.value,
                    role: specs[i]?.role ?? r.role ?? null,
                    exploded: false
                }));

                if (explosionRound === 0) {
                    accumulatedDice = roundDice;
                } else {
                    // Merge explosion re-rolls: add new dice values to matching group totals
                    roundDice.forEach((d) => {
                        accumulatedDice.push({
                            ...d,
                            dieIndex: accumulatedDice.filter((x) => x.groupIndex === d.groupIndex).length,
                            exploded: true
                        });
                    });
                }

                const explodeSpecs = getExplodingRespawnSpecs(parsed, roundDice);
                if (!explodeSpecs.length || explosionRound >= maxExplosionRounds) break;

                specs = explodeSpecs;
                explosionRound++;
            }

            deps.onStateChange?.('evaluating');
            const result = evaluateRoll(parsed, accumulatedDice);
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
 * @param {() => boolean} areDiceSettled
 * @param {(ms?: number) => Promise<void>} waitFrame
 */
async function waitForSettled(areDiceSettled, waitFrame) {
    let idleFrames = 0;
    while (idleFrames < 3) {
        await waitFrame();
        if (areDiceSettled()) idleFrames++;
        else idleFrames = 0;
    }
}

export { NotationError, parseNotation, formatGroupLabel };
