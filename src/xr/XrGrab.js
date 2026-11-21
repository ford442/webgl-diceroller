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
import { nearestWithinReach, PINCH_REACH_M } from './XrPinch.js';

const _raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _attachPoint = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _physicsPoint = new THREE.Vector3();
const _physicsTip = new THREE.Vector3();
const _pinchPoint = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * Controller-ray and hand-pinch grab on the shared WASM kinematic grab helper
 * (the same `setDieKinematic` + velocity path the mouse drag uses). Only one
 * die is held at a time, by whichever controller / hand grabbed it.
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
    /** @type {'ray' | 'pinch'} */
    let grabMode = 'ray';
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
     * @returns {boolean}
     */
    function tryGrab(controllerIndex, controller) {
        if (isWasmDieGrabActive(state)) return false;
        const die = pickDie(controller);
        if (!die) return false;

        controller.getWorldPosition(_origin);
        toPhysicsPoint(_origin, _physicsPoint);
        localOffset.copy(die.position).sub(_physicsPoint);
        startWasmDieGrab(state, die, die.position.clone());
        grabControllerIndex = controllerIndex;
        grabMode = 'ray';
        hooks.onMotionActivityChange?.(true, 'drag');
        return true;
    }

    /**
     * Direct grab: the die nearest a hand's pinch point (world space), if one
     * is within reach.
     * @param {number} handIndex
     * @param {import('three').Vector3} worldPoint
     * @param {number} [reach] meters
     * @returns {boolean}
     */
    function tryGrabNear(handIndex, worldPoint, reach = PINCH_REACH_M) {
        if (isWasmDieGrabActive(state)) return false;
        const candidates = [];
        for (const d of spawnedDice) {
            const mesh = d.mesh;
            if (!mesh) continue;
            const position = mesh.getWorldPosition(new THREE.Vector3());
            mesh.getWorldScale(_scale);
            const geometry = /** @type {import('three').Mesh} */ (mesh).geometry;
            if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere?.();
            const radius = (geometry?.boundingSphere?.radius ?? 0) * _scale.x;
            candidates.push({ item: mesh, position, radius });
        }
        const die = nearestWithinReach(worldPoint, candidates, reach);
        if (!die) return false;
        toPhysicsPoint(worldPoint, _physicsPoint);
        localOffset.copy(die.position).sub(_physicsPoint);
        startWasmDieGrab(state, /** @type {import('three').Mesh} */ (die), die.position.clone());
        grabControllerIndex = handIndex;
        grabMode = 'pinch';
        hooks.onMotionActivityChange?.(true, 'drag');
        return true;
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
     * @param {(index: number, out: import('three').Vector3) => boolean} [getPinchPoint]
     *   world-space pinch point of a hand; false when that hand is not tracked
     */
    function update(deltaTime, controllers, getPinchPoint) {
        if (!isWasmDieGrabActive(state) || grabControllerIndex === null) return;
        if (grabMode === 'pinch') {
            if (!getPinchPoint?.(grabControllerIndex, _pinchPoint)) {
                releaseAll();
                return;
            }
            toPhysicsPoint(_pinchPoint, _physicsPoint);
            _physicsPoint.add(localOffset);
            setWasmDieGrabTarget(state, _physicsPoint);
            updateWasmDieGrab(state, deltaTime);
            return;
        }
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
        tryGrabNear,
        tryRelease,
        update,
        releaseAll,
        isGrabbing: () => isWasmDieGrabActive(state),
        /** @returns {{ index: number, mode: 'ray' | 'pinch' } | null} */
        getGrabSource: () =>
            isWasmDieGrabActive(state) && grabControllerIndex !== null
                ? { index: grabControllerIndex, mode: grabMode }
                : null,
    };
}
