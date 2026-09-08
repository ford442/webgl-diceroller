import * as THREE from 'three';
import {
    spawnedDice,
    driveDieWasmTransform,
    setDieWasmVelocity,
    setDieWasmKinematic,
    findSpawnedDieByPhysicsId,
} from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';

const CAPTURE_RADIUS = 3.0;

const _worldPos = new THREE.Vector3();

/**
 * @typedef {Object} DiceJailControllerDeps
 * @property {ReturnType<import('../environment/DiceJail.js').createDiceJail>} jailProp
 * @property {(message: string) => void} [onFeedback]
 */

/**
 * @param {DiceJailControllerDeps} deps
 */
export function createDiceJailController(deps) {
    const { jailProp, onFeedback } = deps;
    const jailGroup = jailProp.group;
    const halfExtents = jailProp.halfExtents;
    const interiorCenter = jailProp.interiorCenter;

    /** @type {Set<number>} */
    const heldWasmIds = new Set();

    /**
     * @param {'nearby'|number[]} idsOrNearby
     */
    const hold = (idsOrNearby = 'nearby') => {
        if (!isWasmAvailable()) {
            onFeedback?.('Dice jail requires WASM physics');
            return 0;
        }

        jailGroup.updateMatrixWorld(true);
        const base = jailGroup.position;

        const targets =
            idsOrNearby === 'nearby'
                ? spawnedDice.filter((die) => {
                      if (die.wasmId == null) return false;
                      return die.mesh.position.distanceTo(base) <= CAPTURE_RADIUS;
                  })
                : spawnedDice.filter(
                      (die) => die.wasmId != null && idsOrNearby.includes(die.wasmId)
                  );

        if (targets.length === 0) {
            onFeedback?.('No dice near the jail to hold');
            return 0;
        }

        targets.forEach((die, index) => {
            const spread = Math.min(halfExtents.x, halfExtents.z) * 0.6;
            const angle = (index / Math.max(targets.length, 1)) * Math.PI * 2;
            const lx = interiorCenter.x + Math.cos(angle) * spread * 0.5;
            const lz = interiorCenter.z + Math.sin(angle) * spread * 0.5;
            const ly = interiorCenter.y * 0.3;
            _worldPos.set(lx, ly, lz).applyMatrix4(jailGroup.matrixWorld);

            driveDieWasmTransform(die.mesh, _worldPos, die.mesh.quaternion);
            setDieWasmVelocity(die.mesh, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
            setDieWasmKinematic(die.mesh, true);
            heldWasmIds.add(die.wasmId);
        });

        return targets.length;
    };

    const release = () => {
        heldWasmIds.forEach((wasmId) => {
            const die = findSpawnedDieByPhysicsId(wasmId);
            if (die) setDieWasmKinematic(die.mesh, false);
        });
        heldWasmIds.clear();
    };

    const trigger = () => {
        if (heldWasmIds.size > 0) release();
        else hold();
    };

    return {
        hold,
        release,
        trigger,
        getState: () => ({
            available: isWasmAvailable(),
            held: heldWasmIds.size > 0,
            heldCount: heldWasmIds.size,
        }),
    };
}

let activeController = null;

export function registerDiceJailController(controller) {
    activeController = controller;
}

export function getDiceJailController() {
    return activeController;
}
