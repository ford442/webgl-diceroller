/**
 * Ammo.js dice backend — only loaded when `needsAmmoDiceBackend()` is true.
 * Default WASM sessions never import this module (dynamic import from main.js).
 * Receives the already-loaded `physics.js` module via `bindPhysicsModule()` so
 * Rollup does not hoist physics into this async chunk.
 */
import * as THREE from 'three';
import { sharedAmmoTransform, setSharedAmmoTransform } from './DiceState.js';
import {
    getCenterOfMassOffset,
    getGeometryPositionFromBodyTransform,
    getBodyPositionFromGeometry,
    isUsingWasmPhysics,
} from './DicePhysicsPresets.js';

/** @typedef {import('../types/ammo').AmmoRigidBody} AmmoRigidBody */
/** @typedef {import('../types/ammo').AmmoWorld} AmmoWorld */
/** @typedef {import('../types/dice').SpawnedDie} SpawnedDie */
/** @typedef {import('../types/dice').DiceModelTemplate} DiceModelTemplate */

/** @type {typeof import('../physics.js') | null} */
let physics = null;

/**
 * @param {typeof import('../physics.js')} physicsModule
 */
export function bindPhysicsModule(physicsModule) {
    physics = physicsModule;
}

function ph() {
    if (!physics) {
        throw new Error(
            '[AmmoDiceBackend] physics module not bound — load only after initPhysics()'
        );
    }
    return physics;
}

/**
 * @param {DiceModelTemplate | import('three').Mesh | null | undefined} template
 * @returns {import('../types/ammo').AmmoCollisionShape | null}
 */
export function ensureDicePhysicsShape(template) {
    if (!template?.userData) return null;
    if (template.userData.physicsShape) {
        return /** @type {import('../types/ammo').AmmoCollisionShape} */ (
            template.userData.physicsShape
        );
    }
    if (!ph().isAmmoAvailable()) return null;
    const shape = ph().createConvexHullShape(template);
    template.userData.physicsShape = shape;
    return /** @type {import('../types/ammo').AmmoCollisionShape | null} */ (shape);
}

/**
 * @param {AmmoWorld | null | undefined} world
 * @param {import('three').Mesh} mesh
 * @param {DiceModelTemplate | import('three').Mesh} template
 * @param {{ x: number; y: number; z: number }} position
 * @param {{ x: number; y: number; z: number }} rotation
 * @param {import('../types/physicsPresets').PhysicsPreset} physicsPreset
 * @param {import('three').Vector3 | null | undefined} centerOfMassOffset
 * @param {{ type: string; audioBodyId: number; inertiaScalar: number }} meta
 * @returns {AmmoRigidBody | null}
 */
export function spawnAmmoDieBody(
    world,
    mesh,
    template,
    position,
    rotation,
    physicsPreset,
    centerOfMassOffset,
    { type, audioBodyId, inertiaScalar }
) {
    const collisionShape = ensureDicePhysicsShape(template);
    const body = ph().spawnDicePhysics(world, mesh, collisionShape, position, rotation, {
        ...physicsPreset,
        centerOfMassOffset,
    });

    if (body) {
        ph().registerBodyAudioMeta(body, {
            id: audioBodyId,
            type,
            mass: physicsPreset.mass,
            inertiaScalar,
            surface: 'die',
        });
        ph().registerBodyDragMeta(body, {
            dragFactor: physicsPreset.dragFactor ?? 0,
        });
    }

    return body;
}

/** @param {AmmoRigidBody | null | undefined} body */
export function destroyAmmoDieBody(body) {
    if (!body || !ph().isAmmoAvailable()) return;
    const Ammo = ph().getAmmo();
    const ownedCollisionShape = body._ownedCollisionShape ?? null;
    const motionState = body.getMotionState?.();
    if (motionState) Ammo.destroy(motionState);
    Ammo.destroy(body);
    if (ownedCollisionShape) Ammo.destroy(ownedCollisionShape);
}

/**
 * @param {AmmoWorld | null | undefined} world
 * @param {SpawnedDie} die
 */
export function teardownAmmoDieBody(world, die) {
    if (!world || !die?.body) return;
    world.removeRigidBody(die.body);
    ph().unregisterBodyAudioMeta(die.body);
    ph().unregisterBodyDragMeta(die.body);
    destroyAmmoDieBody(die.body);
}

/** @param {SpawnedDie} die */
export function getAmmoTransform(die) {
    const body = die?.body;
    if (!body || !body.getMotionState()) return null;

    const Ammo = ph().getAmmo();
    if (!sharedAmmoTransform) {
        setSharedAmmoTransform(new Ammo.btTransform());
    }

    body.getMotionState().getWorldTransform(sharedAmmoTransform);
    return sharedAmmoTransform;
}

/** @param {SpawnedDie} die @param {boolean} [resetVelocities] */
export function syncBodyTransformFromMesh(die, resetVelocities = true) {
    if (!die?.body || !ph().isAmmoAvailable()) return;

    const Ammo = ph().getAmmo();
    const transform = new Ammo.btTransform();
    transform.setIdentity();
    const bodyPosition = getBodyPositionFromGeometry(
        die.mesh.position,
        die.mesh.quaternion,
        getCenterOfMassOffset(die)
    );
    const origin = new Ammo.btVector3(bodyPosition.x, bodyPosition.y, bodyPosition.z);
    const rotation = new Ammo.btQuaternion(
        die.mesh.quaternion.x,
        die.mesh.quaternion.y,
        die.mesh.quaternion.z,
        die.mesh.quaternion.w
    );
    transform.setOrigin(origin);
    transform.setRotation(rotation);
    die.body.setWorldTransform(transform);
    die.body.getMotionState().setWorldTransform(transform);

    if (resetVelocities) {
        const zeroVec = new Ammo.btVector3(0, 0, 0);
        die.body.setLinearVelocity(zeroVec);
        die.body.setAngularVelocity(zeroVec);
        Ammo.destroy(zeroVec);
    }

    die.body.activate();

    Ammo.destroy(rotation);
    Ammo.destroy(origin);
    Ammo.destroy(transform);
}

export function syncDieStateFromAmmoToWasm(die, syncWasmTransformForDie) {
    if (!isUsingWasmPhysics() || die?.wasmId == null || !die.body) return;

    const transform = getAmmoTransform(die);
    if (!transform) return;

    const origin = transform.getOrigin();
    const rotation = transform.getRotation();
    const linear = die.body.getLinearVelocity();
    const angular = die.body.getAngularVelocity();
    const quaternion = new THREE.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w());
    const position = getGeometryPositionFromBodyTransform(die, origin, quaternion);

    syncWasmTransformForDie(die, {
        position,
        quaternion: { x: rotation.x(), y: rotation.y(), z: rotation.z(), w: rotation.w() },
        linearVelocity: { x: linear.x(), y: linear.y(), z: linear.z() },
        angularVelocity: { x: angular.x(), y: angular.y(), z: angular.z() },
    });
}

export function applyAmmoMassBiasTorque(die, torque, deltaTime) {
    if (!die.body || getCenterOfMassOffset(die) || !ph().isAmmoAvailable()) return;
    const Ammo = ph().getAmmo();
    const torqueImpulse = new Ammo.btVector3(
        torque.x * deltaTime,
        torque.y * deltaTime,
        torque.z * deltaTime
    );
    die.body.applyTorqueImpulse(torqueImpulse);
    die.body.activate();
    Ammo.destroy(torqueImpulse);
}

export function applyAmmoThrowImpulse(
    die,
    transform,
    { x, y, z, q, forceX, forceY, forceZ, spinX, spinY, spinZ }
) {
    const body = die.body;
    if (!body || !transform || !ph().isAmmoAvailable()) return;

    const Ammo = ph().getAmmo();
    const zeroVec = new Ammo.btVector3(0, 0, 0);
    body.setLinearVelocity(zeroVec);
    body.setAngularVelocity(zeroVec);
    Ammo.destroy(zeroVec);

    const bodyPosition = getBodyPositionFromGeometry({ x, y, z }, q, getCenterOfMassOffset(die));

    transform.setIdentity();
    const origin = new Ammo.btVector3(bodyPosition.x, bodyPosition.y, bodyPosition.z);
    transform.setOrigin(origin);
    Ammo.destroy(origin);

    const btQ = new Ammo.btQuaternion(q.x, q.y, q.z, q.w);
    transform.setRotation(btQ);
    Ammo.destroy(btQ);

    body.setWorldTransform(transform);
    body.getMotionState().setWorldTransform(transform);
    body.activate();

    const impulse = new Ammo.btVector3(forceX, forceY, forceZ);
    body.applyCentralImpulse(impulse);
    Ammo.destroy(impulse);

    const torque = new Ammo.btVector3(spinX, spinY, spinZ);
    body.applyTorqueImpulse(torque);
    Ammo.destroy(torque);
}

export function applyAmmoFlickImpulse(die, impulse, torque) {
    if (!die.body || !ph().isAmmoAvailable()) return;
    const Ammo = ph().getAmmo();
    const impulseVec = new Ammo.btVector3(impulse.x, impulse.y, impulse.z);
    die.body.applyCentralImpulse(impulseVec);
    Ammo.destroy(impulseVec);
    const torqueVec = new Ammo.btVector3(torque.x, torque.y, torque.z);
    die.body.applyTorqueImpulse(torqueVec);
    Ammo.destroy(torqueVec);
    die.body.activate();
}

export function createAmmoThrowTransform() {
    if (!ph().isAmmoAvailable()) return null;
    const Ammo = ph().getAmmo();
    return new Ammo.btTransform();
}

export function destroyAmmoThrowTransform(transform) {
    if (!transform || !ph().isAmmoAvailable()) return;
    ph().getAmmo().destroy(transform);
}
