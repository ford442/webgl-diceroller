import * as THREE from 'three';
import {
    spawnedDice,
    driveDieWasmTransform,
    setDieWasmVelocity,
    setDieWasmKinematic,
} from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';

const _worldPos = new THREE.Vector3();
const _identityQuat = new THREE.Quaternion();

/**
 * @typedef {Object} DiceTowerControllerDeps
 * @property {ReturnType<import('../environment/DiceTower.js').createDiceTower>} towerProp
 * @property {() => void} beginTowerRoll
 * @property {(message: string) => void} [onFeedback]
 */

/**
 * @param {DiceTowerControllerDeps} deps
 */
export function createDiceTowerController(deps) {
    const { towerProp, beginTowerRoll, onFeedback } = deps;
    const towerGroup = towerProp.group;
    const hopper = towerProp.hopper;

    /**
     * Teleports the given dice to the hopper mouth and kicks them down the
     * chute; the existing settle-watcher + roll-settled flow takes it from
     * there (same as a cup pour).
     * @param {'all'|number[]} idsOrAll
     */
    const dropDice = (idsOrAll = 'all') => {
        if (!isWasmAvailable()) {
            onFeedback?.('Dice tower requires WASM physics');
            return [];
        }

        const targets =
            idsOrAll === 'all'
                ? spawnedDice.filter((die) => die.wasmId != null)
                : spawnedDice.filter((die) => die.wasmId != null && idsOrAll.includes(die.wasmId));

        if (targets.length === 0) {
            onFeedback?.('No dice to drop through the tower');
            return [];
        }

        towerGroup.updateMatrixWorld(true);
        beginTowerRoll();

        const droppedIds = [];
        targets.forEach((die, index) => {
            const lx = (Math.random() - 0.5) * 2 * hopper.halfWidth;
            const lz = (Math.random() - 0.5) * 2 * hopper.halfDepth;
            const ly = hopper.y + index * 0.35;
            _worldPos.set(lx, ly, lz).applyMatrix4(towerGroup.matrixWorld);

            setDieWasmKinematic(die.mesh, false);
            driveDieWasmTransform(die.mesh, _worldPos, die.mesh.quaternion ?? _identityQuat);
            setDieWasmVelocity(
                die.mesh,
                { x: 0, y: -1.5, z: (Math.random() - 0.5) * 0.5 },
                { x: 0, y: 0, z: 0 }
            );
            droppedIds.push(die.wasmId);
        });

        return droppedIds;
    };

    return {
        dropDice,
        getState: () => ({
            available: isWasmAvailable(),
            diceCount: spawnedDice.filter((die) => die.wasmId != null).length,
        }),
    };
}

let activeController = null;

export function registerDiceTowerController(controller) {
    activeController = controller;
}

export function getDiceTowerController() {
    return activeController;
}
