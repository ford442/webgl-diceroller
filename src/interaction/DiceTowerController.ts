import * as THREE from 'three';
import { spawnedDice, setDieWasmKinematic } from '../dice.js';
import {
    getWasmEngine,
    isWasmAvailable,
    isUsingWorkerPhysics,
    randomPhysicsFloat,
    seedPhysicsRNG,
    seededPhysicsHopperDrop,
} from '../wasm/PhysicsBridge.js';
import {
    applyDropParams,
    computeSeededHopperDropParams,
    type SeededHopperFrame,
} from '../wasm/seededHopperDrop.js';
import { generateRollSeed } from '../roll/ShareableRoll.js';
import type { SeededDieRef } from '../wasm/seededThrowParams.js';

const _axisX = new THREE.Vector3();
const _axisY = new THREE.Vector3();
const _axisZ = new THREE.Vector3();
const _origin = new THREE.Vector3();

interface DropOptions {
    /** Replay a previous drop. Omit to mint a fresh seed for this one. */
    seed?: number | null;
}

/**
 * @typedef {Object} DiceTowerControllerDeps
 * @property {ReturnType<import('../environment/DiceTower.js').createDiceTower>} towerProp
 * @property {(seed?: number | null) => number} beginTowerRoll
 * @property {(message: string) => void} [onFeedback]
 */

/**
 * @param {DiceTowerControllerDeps} deps
 */
export function createDiceTowerController(deps: any) {
    const { towerProp, beginTowerRoll, onFeedback } = deps;
    const towerGroup = towerProp.group;
    const hopper = towerProp.hopper;

    let lastSeed: number | null = null;

    /**
     * The hopper mouth as a world-space origin + orthonormal basis.
     *
     * Read off the tower's live matrix rather than baked in, because the prop
     * is placed (and rotated) by the tier definition: a replay reproduces the
     * *scatter*, and the frame it scatters in comes from wherever the tower
     * actually stands in this scene.
     */
    const hopperFrame = (): SeededHopperFrame => {
        towerGroup.updateMatrixWorld(true);
        towerGroup.matrixWorld.extractBasis(_axisX, _axisY, _axisZ);
        _axisX.normalize();
        _axisY.normalize();
        _axisZ.normalize();
        _origin.setFromMatrixPosition(towerGroup.matrixWorld);
        return {
            origin: { x: _origin.x, y: _origin.y, z: _origin.z },
            axisX: { x: _axisX.x, y: _axisX.y, z: _axisX.z },
            axisY: { x: _axisY.x, y: _axisY.y, z: _axisY.z },
            axisZ: { x: _axisZ.x, y: _axisZ.y, z: _axisZ.z },
            y: hopper.y,
            halfWidth: hopper.halfWidth,
            halfDepth: hopper.halfDepth,
        };
    };

    /**
     * Poses the given dice at the hopper mouth and kicks them down the chute;
     * the existing settle-watcher + roll-settled flow takes it from there.
     *
     * Every draw comes from the engine PRNG seeded with `seed`, in the order
     * `computeSeededHopperDropParams` documents — so a tower dump replays from
     * a share link exactly like a thrown roll does. Unlike a cup pour (which
     * is deliberately local-only, `seed == null`), a drop is a seeded roll.
     *
     * @param {'all'|number[]} idsOrAll
     * @param {DropOptions} options
     */
    const dropDice = (idsOrAll: 'all' | number[] = 'all', options: DropOptions = {}) => {
        if (!isWasmAvailable()) {
            onFeedback?.('Dice tower requires WASM physics');
            return [];
        }

        const targets =
            idsOrAll === 'all'
                ? spawnedDice.filter((die: any) => die.wasmId != null)
                : spawnedDice.filter(
                      (die: any) =>
                          die.wasmId != null &&
                          Array.isArray(idsOrAll) &&
                          idsOrAll.includes(die.wasmId)
                  );

        if (targets.length === 0) {
            onFeedback?.('No dice to drop through the tower');
            return [];
        }

        const requestedSeed = options.seed ?? null;
        // beginTowerRoll owns the seed so the roll it opens and the poses we
        // draw are the same number — it mints one when we pass null.
        const seed = (beginTowerRoll?.(requestedSeed) ?? requestedSeed ?? generateRollSeed()) >>> 0;
        lastSeed = seed;

        const dice: SeededDieRef[] = targets.map((die: any, index: number) => ({
            id: die.wasmId as number,
            index,
        }));
        const frame = hopperFrame();

        // A die held by the cup/grab is kinematic; the drop has to hand it back
        // to the solver before posing it, or the poses never integrate.
        targets.forEach((die: any) => setDieWasmKinematic(die.mesh, false));

        if (isUsingWorkerPhysics()) {
            // RNG draws stay ordered on the worker — `randomFloat()` is not
            // synchronous across the boundary (see docs/WASM_ENGINE.md).
            seededPhysicsHopperDrop(seed, dice, frame);
        } else {
            seedPhysicsRNG(seed);
            applyDropParams(
                getWasmEngine(),
                computeSeededHopperDropParams(() => randomPhysicsFloat(), dice, frame)
            );
        }

        return dice.map((d) => d.id);
    };

    return {
        dropDice,
        hopperFrame,
        getState: () => ({
            available: isWasmAvailable(),
            diceCount: spawnedDice.filter((die: any) => die.wasmId != null).length,
            lastSeed,
        }),
    };
}

let activeController: any = null;

export function registerDiceTowerController(controller: any) {
    activeController = controller;
}

export function getDiceTowerController() {
    return activeController;
}
