import * as THREE from 'three';
import {
    spawnedDice,
    driveDieWasmTransform,
    setDieWasmVelocity,
    setDieWasmKinematic,
    findSpawnedDieByPhysicsId,
} from '../dice.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { jailParkingPose, nextFreeParkingSlot } from './jailParking.js';

const CAPTURE_RADIUS = 3.0;

const _worldPos = new THREE.Vector3();

/**
 * @typedef {Object} DiceJailControllerDeps
 * @property {ReturnType<import('../environment/DiceJail.js').createDiceJail>} jailProp
 * @property {(message: string) => void} [onFeedback]
 */

/**
 * The jail is the *kept set*: a die held here is kinematic in the engine
 * (skipped by `integrate`), and `throwDice` never poses a kinematic die unless
 * its id is named. A game's "set aside" is `hold(ids)`; "throw what is left"
 * is a throw of the other ids; hot dice / end of turn is `release(ids)`.
 *
 * No engine method is added for this: hold is `setDieKinematic(true)` plus a
 * parked pose, release is `setDieKinematic(false)` and leaves the die where it is.
 *
 * @param {DiceJailControllerDeps} deps
 */
export function createDiceJailController(deps: any) {
    const { jailProp, onFeedback } = deps;
    const jailGroup = jailProp.group;
    const halfExtents = jailProp.halfExtents;
    const interiorCenter = jailProp.interiorCenter;

    /** Held physics id → the parking slot it occupies until released. */
    const heldSlots = new Map<number, number>();

    /** Forget held ids whose die left the table (dice set changed under a game). */
    const pruneMissing = () => {
        for (const wasmId of [...heldSlots.keys()]) {
            if (!findSpawnedDieByPhysicsId(wasmId)) heldSlots.delete(wasmId);
        }
    };

    const heldIds = () => [...heldSlots.keys()].sort((a, b) => a - b);

    /**
     * Park dice in the jail and hold them.
     *
     * `'nearby'` (the click toggle) takes every die within reach of the jail;
     * a list takes exactly those physics ids. A die that is already held keeps
     * its slot, so holding the same id twice is a no-op, not a shuffle.
     *
     * @param {'nearby'|number[]} idsOrNearby
     * @returns how many dice were newly held
     */
    const hold = (idsOrNearby: 'nearby' | number[] = 'nearby') => {
        if (!isWasmAvailable()) {
            onFeedback?.('Dice jail requires WASM physics');
            return 0;
        }

        pruneMissing();
        jailGroup.updateMatrixWorld(true);
        const base = jailGroup.position;

        const candidates =
            idsOrNearby === 'nearby'
                ? spawnedDice.filter((die) => {
                      if (die.wasmId == null) return false;
                      return die.mesh.position.distanceTo(base) <= CAPTURE_RADIUS;
                  })
                : spawnedDice.filter(
                      (die) =>
                          die.wasmId != null &&
                          Array.isArray(idsOrNearby) &&
                          idsOrNearby.includes(die.wasmId)
                  );

        if (candidates.length === 0) {
            onFeedback?.('No dice near the jail to hold');
            return 0;
        }

        const layout = {
            center: { x: interiorCenter.x, z: interiorCenter.z },
            minRadius: Math.min(halfExtents.x, halfExtents.z) * 0.3,
        };

        let newlyHeld = 0;
        for (const die of candidates) {
            const wasmId = die.wasmId as number;
            if (heldSlots.has(wasmId)) continue;
            const slot = nextFreeParkingSlot(heldSlots.values());
            if (slot === null) {
                onFeedback?.('The dice jail is full');
                break;
            }
            const pose = jailParkingPose(slot, layout);
            _worldPos.set(pose.x, pose.y, pose.z).applyMatrix4(jailGroup.matrixWorld);

            // Keep the face it settled on: parking must not re-roll the die.
            driveDieWasmTransform(die.mesh, _worldPos, die.mesh.quaternion);
            setDieWasmVelocity(die.mesh, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
            setDieWasmKinematic(die.mesh, true);
            heldSlots.set(wasmId, slot);
            newlyHeld += 1;
        }

        return newlyHeld;
    };

    /**
     * Hand held dice back to the solver. They stay where they are — release
     * does not move or throw anything. No argument releases every held die.
     *
     * @param ids physics ids to release; ones that are not held are ignored
     * @returns how many dice were released
     */
    const release = (ids?: readonly number[] | null) => {
        const wanted = ids ? new Set(ids) : null;
        let released = 0;
        for (const wasmId of [...heldSlots.keys()]) {
            if (wanted && !wanted.has(wasmId)) continue;
            const die = findSpawnedDieByPhysicsId(wasmId);
            if (die) setDieWasmKinematic(die.mesh, false);
            heldSlots.delete(wasmId);
            released += 1;
        }
        return released;
    };

    /**
     * While a game owns the jail, a click on the cage must not toggle it: that
     * would free (or grab) dice behind the rules' back. `hold` / `release`
     * stay open — they are how the game itself moves dice.
     */
    let lockedReason: string | null = null;
    const setLocked = (reason: string | null) => {
        lockedReason = reason;
    };

    const trigger = () => {
        if (lockedReason) {
            onFeedback?.(lockedReason);
            return;
        }
        pruneMissing();
        if (heldSlots.size > 0) release();
        else hold();
    };

    return {
        hold,
        release,
        trigger,
        setLocked,
        getState: () => {
            pruneMissing();
            return {
                available: isWasmAvailable(),
                held: heldSlots.size > 0,
                heldCount: heldSlots.size,
                heldIds: heldIds(),
                locked: lockedReason !== null,
            };
        },
    };
}

export type DiceJailController = ReturnType<typeof createDiceJailController>;

let activeController: any = null;

export function registerDiceJailController(controller: any) {
    activeController = controller;
}

export function getDiceJailController() {
    return activeController;
}
