import * as THREE from 'three';
import { getWasmEngine, pollCollisionEvents } from '../wasm/PhysicsBridge.js';
import { spawnedDice, getAmmoDiceBackend } from './DiceState.js';
import { getGeometryPositionFromBodyTransform, isUsingWasmPhysics } from './DicePhysicsPresets.js';
import { findSpawnedDieByMesh } from './DiceLookup.js';
import { getWasmTransformForDie, WASM_TRANSFORM_STRIDE } from './DiceTransformRead.js';

/** @typedef {import('../types/dice').SpawnedDie} SpawnedDie */
/** @typedef {import('../types/physics').CollisionEvent} CollisionEvent */

/**
 * @param {SpawnedDie} die
 * @param {{
 *   position?: import('three').Vector3;
 *   quaternion?: import('three').Quaternion;
 *   linearVelocity?: { x: number; y: number; z: number } | null;
 *   angularVelocity?: { x: number; y: number; z: number } | null;
 * }} [options]
 */
function syncWasmTransformForDie(die, options = {}) {
    if (!isUsingWasmPhysics() || die?.wasmId == null) return;

    const {
        position = die.mesh.position,
        quaternion = die.mesh.quaternion,
        linearVelocity = null,
        angularVelocity = null,
    } = options;

    const engine = getWasmEngine();
    engine.setDieTransform(
        die.wasmId,
        position.x,
        position.y,
        position.z,
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w
    );

    if (linearVelocity || angularVelocity) {
        engine.setDieVelocity(
            die.wasmId,
            linearVelocity?.x ?? 0,
            linearVelocity?.y ?? 0,
            linearVelocity?.z ?? 0,
            angularVelocity?.x ?? 0,
            angularVelocity?.y ?? 0,
            angularVelocity?.z ?? 0
        );
    }
}

export const updateDiceVisuals = () => {
    const ammoBackend = getAmmoDiceBackend();

    if (isUsingWasmPhysics()) {
        const transforms = getWasmEngine().getTransforms();
        const ids =
            typeof getWasmEngine().getDieIds === 'function' ? getWasmEngine().getDieIds() : null;

        spawnedDice.forEach((die) => {
            if (die.wasmId == null) return;

            let offset = -1;
            if (ids?.length) {
                for (let i = 0; i < ids.length; i++) {
                    if (Math.round(ids[i]) === die.wasmId) {
                        offset = i * WASM_TRANSFORM_STRIDE;
                        break;
                    }
                }
            } else {
                offset = spawnedDice.indexOf(die) * WASM_TRANSFORM_STRIDE;
            }

            if (offset < 0 || offset + (WASM_TRANSFORM_STRIDE - 1) >= transforms.length) return;

            die.mesh.position.set(
                transforms[offset + 0],
                transforms[offset + 1],
                transforms[offset + 2]
            );
            die.mesh.quaternion.set(
                transforms[offset + 3],
                transforms[offset + 4],
                transforms[offset + 5],
                transforms[offset + 6]
            );
        });

        return;
    }

    if (!ammoBackend) return;

    spawnedDice.forEach((die) => {
        const transform = ammoBackend.getAmmoTransform(die);
        if (!transform) return;
        const origin = transform.getOrigin();
        const rotation = transform.getRotation();
        const quaternion = new THREE.Quaternion(
            rotation.x(),
            rotation.y(),
            rotation.z(),
            rotation.w()
        );
        const position = getGeometryPositionFromBodyTransform(die, origin, quaternion);
        die.mesh.position.set(position.x, position.y, position.z);
        die.mesh.quaternion.copy(quaternion);
    });
};

/**
 * Push the current mesh transform into the die's ammo body before an ammo-side
 * interaction (drag / levitation). Only reachable on the `?no-wasm` fallback —
 * WASM sessions have no ammo body to prepare.
 */
export const prepareDieForAmmoInteraction = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    const ammoBackend = getAmmoDiceBackend();
    if (!die?.body || !ammoBackend) return;
    ammoBackend.syncBodyTransformFromMesh(die, true);
};

export const syncDieBodyStateToWasm = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    const ammoBackend = getAmmoDiceBackend();
    if (!die || !ammoBackend) return;
    ammoBackend.syncDieStateFromAmmoToWasm(die, syncWasmTransformForDie);
};

export const syncDieMeshStateToWasm = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!die) return;
    syncWasmTransformForDie(die);
};

export const applyWasmImpulseForDie = (mesh, impulse, torque) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;

    const engine = getWasmEngine();
    if (impulse) {
        engine.applyImpulse(die.wasmId, impulse.x, impulse.y, impulse.z);
    }
    if (torque) {
        engine.applyTorqueImpulse(die.wasmId, torque.x, torque.y, torque.z);
    }
};

export const driveDieWasmTransform = (mesh, position, quaternion) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    syncWasmTransformForDie(die, { position, quaternion });
};

let _warnedMissingKinematic = false;

/**
 * Hold/release a die as a kinematic body in the WASM engine.
 *
 * Every live bridge (worker + main-thread WASM) implements `setDieKinematic`.
 * If an older WASM artifact is loaded without it, fall back to zeroing the
 * die's velocity so a held die does not accelerate away while the caller keeps
 * driving its transform each frame.
 */
export const setDieWasmKinematic = (mesh, kinematic) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    const engine = getWasmEngine();
    if (typeof engine.setDieKinematic === 'function') {
        engine.setDieKinematic(die.wasmId, kinematic);
        return;
    }

    if (!_warnedMissingKinematic) {
        _warnedMissingKinematic = true;
        console.warn(
            '[DiceSync] WASM engine lacks setDieKinematic — rebuild with `npm run build:wasm`. ' +
                'Falling back to velocity clamping for held dice.'
        );
    }
    if (kinematic) {
        engine.setDieVelocity(die.wasmId, 0, 0, 0, 0, 0, 0);
    }
};

export const setDieWasmVelocity = (mesh, linear = null, angular = null) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    getWasmEngine().setDieVelocity(
        die.wasmId,
        linear?.x ?? 0,
        linear?.y ?? 0,
        linear?.z ?? 0,
        angular?.x ?? 0,
        angular?.y ?? 0,
        angular?.z ?? 0
    );
};

export const getDieWasmTransform = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return null;
    return getWasmTransformForDie(die.wasmId);
};

/**
 * @returns {Array<CollisionEvent & { otherSurface?: string }>}
 */
export const pollPhysicsCollisionEvents = () => {
    const SURFACES = ['default', 'velvet', 'wood', 'metal', 'leather'];
    return pollCollisionEvents().map((ev) => {
        if (ev.materialTag != null && ev.materialTag > 0) {
            return {
                ...ev,
                otherSurface: SURFACES[ev.materialTag] ?? 'default',
            };
        }
        if (ev.idB <= -2000) {
            return { ...ev, otherSurface: SURFACES[ev.materialTag ?? 0] ?? 'default' };
        }
        if (ev.idB <= -100) {
            return { ...ev, otherSurface: 'leather' };
        }
        if (ev.idB === -1) {
            return { ...ev, otherSurface: 'velvet' };
        }
        return ev;
    });
};
