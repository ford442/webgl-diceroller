import * as THREE from 'three';
import { tween } from '../interactables/tween.js';
import { isWasmAvailable, setContainerActive, setContainerPlanes } from '../wasm/PhysicsBridge.js';
import { spawnedDice, driveDieWasmTransform, setDieWasmVelocity } from '../dice.js';
import { isNotationRollActive } from '../roll/RollSession.js';
import { DICE_CUP_INTERIOR_HEIGHT, DICE_CUP_INTERIOR_RADIUS } from '../environment/DiceCup.js';
import { TABLE_SURFACE_Y } from '../core/SceneMetrics.js';

const SCOOP_RADIUS = 4.0;
const SHAKE_WIGGLE = 0.22;
const MAX_LIFT_Y = TABLE_SURFACE_Y + 2.2;
const POUR_DURATION_MS = 520;

const _localNormal = new THREE.Vector3();
const _localPoint = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _worldPoint = new THREE.Vector3();
const _planeScratch = new Float32Array(36);
const _cupTarget = new THREE.Vector3();
const _pourTarget = new THREE.Vector3(0, TABLE_SURFACE_Y + 0.5, 0);
const _restPos = new THREE.Vector3();
const _restQuat = new THREE.Quaternion();
const _scratchQuat = new THREE.Quaternion();
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * @typedef {Object} DiceCupControllerDeps
 * @property {ReturnType<import('../environment/DiceCup.js').createDiceCup>} cupProp
 * @property {THREE.Camera} camera
 * @property {() => void} beginCupRoll
 * @property {(active: boolean, source?: string) => void} [onMotionActivityChange]
 * @property {() => boolean} [canStartCupInteraction]
 * @property {(message: string) => void} [onFeedback]
 */

/**
 * @param {DiceCupControllerDeps} deps
 */
export function createDiceCupController(deps) {
    const {
        cupProp,
        camera,
        beginCupRoll,
        onMotionActivityChange,
        onFeedback,
        canStartCupInteraction = () => true,
    } = deps;
    const cupGroup = cupProp.group;
    const localPlanes = cupProp.colliderLocalPlanes;

    /** @type {'idle'|'shaking'|'pouring'} */
    let state = 'idle';
    let pointerHeld = false;
    let wigglePhase = 0;
    let mouseDeltaX = 0;
    let mouseDeltaY = 0;
    /** @type {number[]} */
    let scoopedWasmIds = [];

    const uploadPlanes = () => {
        cupGroup.updateMatrixWorld(true);
        const m = cupGroup.matrixWorld;
        const count = localPlanes.length / 4;
        for (let i = 0; i < count; i++) {
            const i4 = i * 4;
            _localNormal.set(localPlanes[i4], localPlanes[i4 + 1], localPlanes[i4 + 2]);
            _localPoint.copy(_localNormal).multiplyScalar(localPlanes[i4 + 3]);
            _worldNormal.copy(_localNormal).transformDirection(m).normalize();
            _worldPoint.copy(_localPoint).applyMatrix4(m);
            const d = _worldNormal.dot(_worldPoint);
            _planeScratch[i4] = _worldNormal.x;
            _planeScratch[i4 + 1] = _worldNormal.y;
            _planeScratch[i4 + 2] = _worldNormal.z;
            _planeScratch[i4 + 3] = d;
        }
        setContainerPlanes(_planeScratch.subarray(0, localPlanes.length));
    };

    const projectCursorToPlane = (normX, normY) => {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(normX, normY), camera);
        const plane = new THREE.Plane();
        const planePoint = new THREE.Vector3(cupGroup.position.x, MAX_LIFT_Y, cupGroup.position.z);
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), planePoint);
        const target = new THREE.Vector3();
        return raycaster.ray.intersectPlane(plane, target) ? target : null;
    };

    const scoopNearbyDice = () => {
        const base = cupGroup.position;
        const scooped = [];
        spawnedDice.forEach((die) => {
            if (die.wasmId == null) return;
            const dx = die.mesh.position.x - base.x;
            const dy = die.mesh.position.y - base.y;
            const dz = die.mesh.position.z - base.z;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) > SCOOP_RADIUS) return;

            const lx = (Math.random() - 0.5) * DICE_CUP_INTERIOR_RADIUS * 1.2;
            const lz = (Math.random() - 0.5) * DICE_CUP_INTERIOR_RADIUS * 1.2;
            const ly = 0.15 + Math.random() * (DICE_CUP_INTERIOR_HEIGHT * 0.65);
            const wx = base.x + lx;
            const wy = base.y + ly;
            const wz = base.z + lz;
            driveDieWasmTransform(die.mesh, new THREE.Vector3(wx, wy, wz), die.mesh.quaternion);
            setDieWasmVelocity(die.mesh, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
            scooped.push(die.wasmId);
        });
        return scooped;
    };

    const resetCupTransform = () => {
        cupGroup.position.copy(_restPos);
        cupGroup.quaternion.copy(_restQuat);
    };

    const startPour = () => {
        if (state !== 'shaking') return;
        state = 'pouring';
        pointerHeld = false;
        onMotionActivityChange?.(true, 'cup');

        const startQuat = cupGroup.quaternion.clone();
        const startPos = cupGroup.position.clone();
        const lipDir = _pourTarget.clone().sub(cupGroup.position).normalize();
        const pourQuat = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
                Math.atan2(lipDir.y, Math.sqrt(lipDir.x * lipDir.x + lipDir.z * lipDir.z)),
                Math.atan2(lipDir.x, lipDir.z) + Math.PI * 0.5,
                0,
                'YXZ'
            )
        );
        pourQuat.multiply(
            _scratchQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI * 0.55)
        );

        beginCupRoll();

        tween({
            duration: POUR_DURATION_MS,
            onUpdate: (t) => {
                cupGroup.quaternion.slerpQuaternions(startQuat, pourQuat, t);
                cupGroup.position.lerpVectors(startPos, _pourTarget, t * 0.35);
                uploadPlanes();
                if (t >= 0.55 && t < 0.56) {
                    setContainerActive(false);
                }
            },
            onComplete: () => {
                setContainerActive(false);
                resetCupTransform();
                state = 'idle';
                scoopedWasmIds = [];
                onMotionActivityChange?.(false, 'cup');
            },
        });
    };

    const tryGrabCup = () => {
        if (!isWasmAvailable()) {
            onFeedback?.('Dice cup requires WASM physics');
            return;
        }
        if (state !== 'idle') return;
        if (isNotationRollActive() || !canStartCupInteraction()) return;

        _restPos.copy(cupGroup.position);
        _restQuat.copy(cupGroup.quaternion);

        scoopedWasmIds = scoopNearbyDice();
        if (scoopedWasmIds.length === 0) {
            onFeedback?.('Move dice closer to the cup');
            tween({
                duration: 220,
                onUpdate: (t, p) => {
                    cupGroup.rotation.z = Math.sin(p * Math.PI * 4) * 0.08 * (1 - t);
                },
                onComplete: () => {
                    cupGroup.rotation.z = 0;
                },
            });
            return;
        }

        state = 'shaking';
        pointerHeld = true;
        wigglePhase = 0;
        setContainerActive(true);
        uploadPlanes();
        onMotionActivityChange?.(true, 'cup');
    };

    return {
        tryGrabCup,
        isCupInteractionActive: () => state === 'shaking' || state === 'pouring',
        getState: () => ({
            available: isWasmAvailable(),
            state,
            scoopedCount: scoopedWasmIds.length,
        }),

        handlePointerMove(normX, normY, prevNormX, prevNormY) {
            if (state !== 'shaking') return;
            mouseDeltaX += normX - prevNormX;
            mouseDeltaY += normY - prevNormY;

            const target = projectCursorToPlane(normX, normY);
            if (target) {
                _cupTarget.copy(target);
                cupGroup.position.lerp(_cupTarget, 0.35);
            }
        },

        handlePointerUp() {
            if (state === 'shaking' && pointerHeld) {
                pointerHeld = false;
                startPour();
            }
        },

        handlePourKey() {
            if (state === 'shaking') startPour();
        },

        update(deltaTime) {
            if (state !== 'shaking') return;

            wigglePhase += deltaTime * 14;
            const wobbleX = Math.sin(wigglePhase * 1.7) * SHAKE_WIGGLE + mouseDeltaX * 2.5;
            const wobbleZ = Math.cos(wigglePhase * 2.1) * SHAKE_WIGGLE + mouseDeltaY * 2.5;
            mouseDeltaX *= 0.82;
            mouseDeltaY *= 0.82;

            _scratchEuler.set(wobbleX, 0, wobbleZ);
            _scratchQuat.setFromEuler(_scratchEuler);
            cupGroup.quaternion.copy(_restQuat).multiply(_scratchQuat);

            uploadPlanes();
        },
    };
}

let activeController = null;

export function registerDiceCupController(controller) {
    activeController = controller;
}

export function getDiceCupController() {
    return activeController;
}

export function isCupInteractionActive() {
    return activeController?.isCupInteractionActive() ?? false;
}
