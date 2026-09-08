import * as THREE from 'three';
import { applyWasmImpulseForDie, driveDieWasmTransform, setDieWasmKinematic } from '../dice.js';

/** Max release linear speed (scene units / s), shared by mouse + XR grab. */
export const MAX_DRAG_SPEED = 60;

/**
 * The engine calls this state machine drives to hold/release a body. Default
 * is the die driver (below); a dynamic-prop grab passes
 * `environment/DynamicPropSync.js`'s `propWasmGrabDriver` instead — same
 * kinematic-while-held / impulse-on-release mechanics for either body kind.
 * @typedef {Object} WasmGrabDriver
 * @property {(mesh: import('three').Object3D, kinematic: boolean) => void} setKinematic
 * @property {(mesh: import('three').Object3D, position: import('three').Vector3, quaternion: import('three').Quaternion) => void} driveTransform
 * @property {(mesh: import('three').Object3D, impulse: {x:number,y:number,z:number}|null, torque: {x:number,y:number,z:number}|null) => void} applyImpulse
 */

/** @type {WasmGrabDriver} */
const DIE_DRIVER = {
    setKinematic: setDieWasmKinematic,
    driveTransform: driveDieWasmTransform,
    applyImpulse: applyWasmImpulseForDie,
};

/**
 * @typedef {Object} WasmDieGrabState
 * @property {import('three').Object3D | null} mesh
 * @property {boolean} active
 * @property {import('three').Vector3} target
 * @property {boolean} hasTarget
 * @property {import('three').Vector3} prevTarget
 * @property {boolean} hasPrev
 * @property {import('three').Vector3} releaseVel
 * @property {WasmGrabDriver} driver
 */

/** @returns {WasmDieGrabState} */
export function createWasmDieGrabState() {
    return {
        mesh: null,
        active: false,
        target: new THREE.Vector3(),
        hasTarget: false,
        prevTarget: new THREE.Vector3(),
        hasPrev: false,
        releaseVel: new THREE.Vector3(),
        driver: DIE_DRIVER,
    };
}

/**
 * Begin a kinematic WASM grab on a die (default) or dynamic-prop mesh.
 * @param {WasmDieGrabState} state
 * @param {import('three').Object3D} mesh
 * @param {import('three').Vector3} point
 * @param {WasmGrabDriver} [driver]
 */
export function startWasmDieGrab(state, mesh, point, driver = DIE_DRIVER) {
    state.driver = driver;
    driver.setKinematic(mesh, true);
    state.mesh = mesh;
    state.active = true;
    state.hasTarget = true;
    state.target.copy(point);
    state.hasPrev = false;
    state.releaseVel.set(0, 0, 0);
}

/**
 * Update grab target world position (call from pointer/controller move).
 * @param {WasmDieGrabState} state
 * @param {import('three').Vector3} point
 */
export function setWasmDieGrabTarget(state, point) {
    if (!state.active) return;
    state.target.copy(point);
    state.hasTarget = true;
}

/**
 * Drive the held die toward the current target; accumulate release velocity.
 * @param {WasmDieGrabState} state
 * @param {number} deltaTime
 */
export function updateWasmDieGrab(state, deltaTime) {
    if (!state.active || !state.mesh || !state.hasTarget) return;
    const dt = deltaTime > 0 ? deltaTime : 1 / 60;

    if (state.hasPrev) {
        state.releaseVel.copy(state.target).sub(state.prevTarget).divideScalar(dt);
        if (state.releaseVel.lengthSq() > MAX_DRAG_SPEED * MAX_DRAG_SPEED) {
            state.releaseVel.setLength(MAX_DRAG_SPEED);
        }
    }
    state.prevTarget.copy(state.target);
    state.hasPrev = true;

    state.driver.driveTransform(state.mesh, state.target, state.mesh.quaternion);
    state.mesh.position.copy(state.target);
}

/**
 * Release the die with impulse from tracked velocity.
 * @param {WasmDieGrabState} state
 * @param {{ onReleased?: () => void }} [hooks]
 */
export function endWasmDieGrab(state, hooks = {}) {
    if (!state.active) return;

    const mesh = state.mesh;
    if (mesh) {
        state.driver.setKinematic(mesh, false);
        if (state.hasPrev && state.releaseVel.lengthSq() > 0.0001) {
            state.driver.applyImpulse(
                mesh,
                {
                    x: state.releaseVel.x,
                    y: state.releaseVel.y,
                    z: state.releaseVel.z,
                },
                null
            );
        }
    }

    state.active = false;
    state.hasTarget = false;
    state.hasPrev = false;
    state.mesh = null;
    state.driver = DIE_DRIVER;
    state.releaseVel.set(0, 0, 0);
    hooks.onReleased?.();
}

/**
 * @param {WasmDieGrabState} state
 * @returns {boolean}
 */
export function isWasmDieGrabActive(state) {
    return state.active && state.mesh !== null;
}
