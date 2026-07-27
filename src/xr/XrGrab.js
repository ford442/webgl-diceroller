import * as THREE from 'three';
import { spawnedDice } from '../dice.js';
import {
    createWasmDieGrabState,
    startWasmDieGrab,
    setWasmDieGrabTarget,
    updateWasmDieGrab,
    endWasmDieGrab,
    isWasmDieGrabActive,
} from '../interaction/WasmDieGrab.js';

const _raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _attachPoint = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _physicsPoint = new THREE.Vector3();
const _physicsTip = new THREE.Vector3();

/**
 * Controller-ray grab using the shared WASM kinematic grab helper.
 * @param {object} [options]
 * @param {() => import('three').Object3D | null | undefined} [options.getContentRoot]
 *   XR world group (scaled). Grab targets are converted into this space for physics.
 * @param {{ onMotionActivityChange?: (active: boolean, reason: 'drag') => void }} [options.hooks]
 */
export function createXrGrab(options = {}) {
    const { getContentRoot, hooks = {} } = options;
    const state = createWasmDieGrabState();
    /** @type {number | null} */
    let grabControllerIndex = null;
    /** Offset from controller (physics space) to die at grab start */
    const localOffset = new THREE.Vector3();

    /** @param {import('three').Vector3} worldPoint @param {import('three').Vector3} out */
    function toPhysicsPoint(worldPoint, out) {
        const root = getContentRoot?.();
        out.copy(worldPoint);
        if (root) root.worldToLocal(out);
        return out;
    }

    /**
     * @param {import('three').Object3D} controller
     * @returns {import('three').Mesh | null}
     */
    function pickDie(controller) {
        controller.getWorldPosition(_origin);
        controller.getWorldQuaternion(_quat);
        _direction.set(0, 0, -1).applyQuaternion(_quat);
        _raycaster.set(_origin, _direction);
        _raycaster.far = 4;

        const meshes = spawnedDice.map((d) => d.mesh);
        if (!meshes.length) return null;
        const hits = _raycaster.intersectObjects(meshes, true);
        if (!hits.length) return null;

        /** @type {import('three').Object3D | null} */
        let object = hits[0].object;
        while (object && !object.userData.isDie && !object.userData.body && object.parent) {
            object = object.parent;
        }
        return object?.userData?.isDie || object?.userData?.body
            ? /** @type {import('three').Mesh} */ (object)
            : null;
    }

    /**
     * @param {number} controllerIndex
     * @param {import('three').Object3D} controller
     */
    function tryGrab(controllerIndex, controller) {
        if (isWasmDieGrabActive(state)) return;
        const die = pickDie(controller);
        if (!die) return;

        controller.getWorldPosition(_origin);
        toPhysicsPoint(_origin, _physicsPoint);
        localOffset.copy(die.position).sub(_physicsPoint);
        startWasmDieGrab(state, die, die.position.clone());
        grabControllerIndex = controllerIndex;
        hooks.onMotionActivityChange?.(true, 'drag');
    }

    /**
     * @param {number} controllerIndex
     */
    function tryRelease(controllerIndex) {
        if (grabControllerIndex !== controllerIndex) return;
        endWasmDieGrab(state, {
            onReleased: () => hooks.onMotionActivityChange?.(false, 'drag'),
        });
        grabControllerIndex = null;
    }

    /**
     * @param {number} deltaTime
     * @param {import('three').Object3D[]} controllers
     */
    function update(deltaTime, controllers) {
        if (!isWasmDieGrabActive(state) || grabControllerIndex === null) return;
        const controller = controllers[grabControllerIndex];
        if (!controller) {
            endWasmDieGrab(state, {
                onReleased: () => hooks.onMotionActivityChange?.(false, 'drag'),
            });
            grabControllerIndex = null;
            return;
        }

        controller.getWorldPosition(_origin);
        controller.getWorldQuaternion(_quat);
        _direction.set(0, 0, -1).applyQuaternion(_quat);
        _tip.copy(_origin).addScaledVector(_direction, 0.15);
        _attachPoint.lerpVectors(_origin, _tip, 0.35);

        toPhysicsPoint(_attachPoint, _physicsPoint);
        toPhysicsPoint(_tip, _physicsTip);
        _physicsPoint.add(localOffset);
        _physicsPoint.lerp(_physicsTip, 0.25);

        setWasmDieGrabTarget(state, _physicsPoint);
        updateWasmDieGrab(state, deltaTime);
    }

    function releaseAll() {
        if (!isWasmDieGrabActive(state)) return;
        endWasmDieGrab(state, {
            onReleased: () => hooks.onMotionActivityChange?.(false, 'drag'),
        });
        grabControllerIndex = null;
    }

    return {
        tryGrab,
        tryRelease,
        update,
        releaseAll,
        isGrabbing: () => isWasmDieGrabActive(state),
    };
}
