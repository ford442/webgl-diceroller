import * as THREE from 'three';
import { getAmmo } from './physics.js';
import { isWasmAvailable, isWasmInitialized } from './wasm/PhysicsBridge.js';
import {
    spawnedDice,
    prepareDieForAmmoInteraction,
    setDiePhysicsAuthority,
    syncDieBodyStateToWasm,
    syncDieMeshStateToWasm,
    applyWasmImpulseForDie,
    driveDieWasmTransform,
    setDieWasmKinematic,
} from './dice.js';
import { isCupInteractionActive, getDiceCupController } from './interaction/DiceCupController.js';
import {
    createWasmDieGrabState,
    startWasmDieGrab,
    setWasmDieGrabTarget,
    updateWasmDieGrab,
    endWasmDieGrab,
} from './interaction/WasmDieGrab.js';

/** @typedef {import('./types/ammo').AmmoRigidBody} AmmoRigidBody */
/** @typedef {import('./types/ammo').AmmoWorld} AmmoWorld */
/** @typedef {import('./types/ammo').AmmoPoint2PointConstraint} AmmoPoint2PointConstraint */

/**
 * @typedef {Object} InteractionHooks
 * @property {(active: boolean, reason: 'drag' | 'levitation') => void} [onMotionActivityChange]
 */

/**
 * @typedef {Object} InteractiveObjectEntry
 * @property {import('three').Object3D} mesh
 * @property {() => void} callback
 */

/**
 * @typedef {Object} LevitationState
 * @property {import('three').Mesh} object
 * @property {AmmoRigidBody | null | undefined} body
 * @property {import('three').PointLight} light
 * @property {import('three').Scene} scene
 * @property {AmmoWorld | null | undefined} physicsWorld
 * @property {InteractionHooks} hooks
 * @property {boolean} wasm
 * @property {number} startTime
 * @property {number} startX
 * @property {number} startZ
 * @property {number} startY
 * @property {number} targetY
 * @property {import('three').Quaternion} spinQuat
 * @property {'lifting'} state
 */

/** @type {import('three').Raycaster | undefined} */
let raycaster;
/** @type {import('three').Vector2 | undefined} */
let mouse;
let prevMouse = new THREE.Vector2(0, 0);
/** @type {import('three').Mesh | null} */
let draggedItem = null;
/** @type {AmmoPoint2PointConstraint | null} */
let dragConstraint = null;

const _interactionParams = new URLSearchParams(window.location.search);
const _ammoDragRequested = _interactionParams.has('ammo-drag');
const isWasmInteractionMode = () => !_ammoDragRequested && isWasmInitialized() && isWasmAvailable();

const wasmGrab = createWasmDieGrabState();

let lastClickTime = 0;
/** @type {import('three').Object3D | null} */
let lastClickObject = null;
const DOUBLE_CLICK_DELAY = 300;

/** @type {InteractiveObjectEntry[]} */
const interactiveObjects = [];

/**
 * @param {import('three').Camera} camera
 * @param {import('three').Scene} scene
 * @param {AmmoWorld | null | undefined} physicsWorld
 * @param {InteractionHooks} [hooks]
 */
export const initInteraction = (camera, scene, physicsWorld, hooks = {}) => {
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    const warmMaterials = () => {
        if (!scene.userData.renderer) {
            requestAnimationFrame(warmMaterials);
            return;
        }
        const warmLight = new THREE.PointLight(0x0088ff, 1, 1);
        const warmGeo = new THREE.SphereGeometry(0.01, 4, 4);
        const warmMat = new THREE.MeshBasicMaterial({ color: 0x0088ff });
        const warmMesh = new THREE.Mesh(warmGeo, warmMat);
        warmMesh.add(warmLight);
        warmMesh.position.set(0, -1000, 0);
        scene.add(warmMesh);

        if (typeof scene.userData.renderer.compile === 'function') {
            scene.userData.renderer.compile(scene, camera);
        }

        setTimeout(() => {
            scene.remove(warmMesh);
            warmGeo.dispose();
            warmMat.dispose();
            warmLight.dispose();
        }, 500);
    };

    requestAnimationFrame(warmMaterials);

    return {
        handleDown: (x, y) => onPointerDown(x, y, camera, scene, physicsWorld, hooks),
        handleMove: (x, y) => onPointerMove(x, y, camera),
        handleUp: () => onPointerUp(physicsWorld, hooks),
    };
};

/**
 * @param {import('three').Object3D} mesh
 * @param {() => void} callback
 */
export const registerInteractiveObject = (mesh, callback) => {
    interactiveObjects.push({ mesh, callback });
};

/** @param {import('three').Object3D} mesh */
export const unregisterInteractiveObject = (mesh) => {
    const index = interactiveObjects.findIndex((entry) => entry.mesh === mesh);
    if (index >= 0) interactiveObjects.splice(index, 1);
};

/**
 * @param {number} x
 * @param {number} y
 * @param {import('three').Camera} camera
 * @param {import('three').Scene} scene
 * @param {AmmoWorld | null | undefined} physicsWorld
 * @param {InteractionHooks} [hooks]
 */
function onPointerDown(x, y, camera, scene, physicsWorld, hooks = {}) {
    updateMouse(x, y);

    raycaster.setFromCamera(mouse, camera);
    raycaster.params.Points.threshold = 0.1;
    raycaster.params.Line.threshold = 0.1;

    if (interactiveObjects.length > 0) {
        const interactiveMeshes = interactiveObjects.map((obj) => obj.mesh);
        const intersectsInteractive = raycaster.intersectObjects(interactiveMeshes, true);

        if (intersectsInteractive.length > 0) {
            const hit = intersectsInteractive[0];
            const registered = interactiveObjects.find((io) => {
                return io.mesh === hit.object || isDescendant(hit.object, io.mesh);
            });

            if (registered) {
                registered.callback();
                return;
            }
        }
    }

    if (isCupInteractionActive()) return;

    const diceGroups = spawnedDice.map((d) => d.mesh);
    const intersects = raycaster.intersectObjects(diceGroups, true);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        /** @type {import('three').Object3D | null} */
        let object = intersect.object;
        const point = intersect.point;

        while (object && !object.userData.isDie && !object.userData.body && object.parent) {
            object = object.parent;
        }

        if (object && (object.userData.isDie || object.userData.body)) {
            const wasmMode = isWasmInteractionMode();
            if (!wasmMode)
                prepareDieForAmmoInteraction(/** @type {import('three').Mesh} */ (object));

            const now = Date.now();
            if (lastClickObject === object && now - lastClickTime < DOUBLE_CLICK_DELAY) {
                triggerLevitation(
                    /** @type {import('three').Mesh} */ (object),
                    scene,
                    physicsWorld,
                    hooks
                );
                lastClickObject = null;
                lastClickTime = 0;
                return;
            }

            lastClickTime = now;
            lastClickObject = object;

            draggedItem = /** @type {import('three').Mesh} */ (object);
            hooks.onMotionActivityChange?.(true, 'drag');
            if (wasmMode) {
                startWasmDieGrab(wasmGrab, draggedItem, point);
            } else {
                startDrag(object.userData.body, point, physicsWorld);
            }
        }
    }
}

/**
 * @param {import('three').Object3D} child @param {import('three').Object3D} parent
 */
function isDescendant(child, parent) {
    let curr = child.parent;
    while (curr) {
        if (curr === parent) return true;
        curr = curr.parent;
    }
    return false;
}

/** @param {number} x @param {number} y @param {import('three').Camera} camera */
function onPointerMove(x, y, camera) {
    updateMouse(x, y);

    const cup = getDiceCupController();
    if (cup) {
        cup.handlePointerMove(x, y, prevMouse.x, prevMouse.y);
    }
    prevMouse.set(x, y);

    if (!draggedItem) return;

    const target = projectCursorToDiePlane(camera);
    if (!target) return;

    if (wasmGrab.active) {
        setWasmDieGrabTarget(wasmGrab, target);
    } else if (dragConstraint) {
        const Ammo = getAmmo();
        if (!Ammo) return;
        dragConstraint.setPivotB(new Ammo.btVector3(target.x, target.y, target.z));
    }
}

/** @param {import('three').Camera} camera @returns {import('three').Vector3 | null} */
function projectCursorToDiePlane(camera) {
    if (!draggedItem) return null;
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane();
    plane.setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        draggedItem.position
    );
    const target = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, target) ? target : null;
}

/** @param {AmmoWorld | null | undefined} physicsWorld @param {InteractionHooks} [hooks] */
function onPointerUp(physicsWorld, hooks = {}) {
    getDiceCupController()?.handlePointerUp();

    if (wasmGrab.active) {
        endWasmDieGrab(wasmGrab, {
            onReleased: () => hooks.onMotionActivityChange?.(false, 'drag'),
        });
        draggedItem = null;
        return;
    }

    if (dragConstraint && draggedItem) {
        const Ammo = getAmmo();
        if (Ammo && physicsWorld) {
            syncDieBodyStateToWasm(draggedItem);
            setDiePhysicsAuthority(draggedItem, 'wasm');
            physicsWorld.removeConstraint?.(dragConstraint);
            Ammo.destroy(dragConstraint);
        }
        dragConstraint = null;
        draggedItem = null;
        hooks.onMotionActivityChange?.(false, 'drag');
    }
}

/** @param {number} x @param {number} y */
function updateMouse(x, y) {
    if (!mouse) return;
    mouse.x = x;
    mouse.y = y;
}

/**
 * @param {AmmoRigidBody | null | undefined} body
 * @param {import('three').Vector3} point
 * @param {AmmoWorld | null | undefined} physicsWorld
 */
function startDrag(body, point, physicsWorld) {
    const Ammo = getAmmo();
    if (!Ammo || !body || !physicsWorld || !draggedItem) return;
    const localPointThree = draggedItem.worldToLocal(point.clone());
    const localPivotAmmo = new Ammo.btVector3(
        localPointThree.x,
        localPointThree.y,
        localPointThree.z
    );

    dragConstraint = new Ammo.btPoint2PointConstraint(body, localPivotAmmo);

    const setting =
        typeof dragConstraint.get_m_setting === 'function'
            ? dragConstraint.get_m_setting()
            : dragConstraint.m_setting || null;
    if (setting) {
        /** @type {import('./types/ammo').AmmoConstraintSettings} */
        const constraintSettings = setting;
        if (typeof constraintSettings.set_m_impulseClamp === 'function') {
            constraintSettings.set_m_impulseClamp(100);
            constraintSettings.set_m_tau(0.001);
            constraintSettings.set_m_damping(1.0);
        } else {
            constraintSettings.m_impulseClamp = 100;
            constraintSettings.m_tau = 0.001;
            constraintSettings.m_damping = 1.0;
        }
    }

    physicsWorld.addConstraint?.(dragConstraint);
    body.activate?.();
}

/** @param {number} [deltaTime] */
export const updateInteraction = (deltaTime = 1 / 60) => {
    if (wasmGrab.active) {
        updateWasmDieGrab(wasmGrab, deltaTime);
    } else if (draggedItem?.userData.body) {
        draggedItem.userData.body.activate?.();
    }
    updateLevitation();
};

export const isDragging = () => draggedItem !== null;
export const hasActiveDiceInteraction = () => draggedItem !== null || levitatingDice.length > 0;

export const interactionNeedsAmmoStep = () =>
    !isWasmInteractionMode() && hasActiveDiceInteraction();

/**
 * @param {import('three').Camera} camera
 * @param {number} normX
 * @param {number} normY
 */
export const isHoveringOverDice = (camera, normX, normY) => {
    if (!raycaster || !mouse) return false;
    mouse.x = normX;
    mouse.y = normY;
    raycaster.setFromCamera(mouse, camera);
    const meshes = spawnedDice.map((d) => d.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    return intersects.length > 0;
};

/**
 * @param {import('three').Camera} camera
 * @param {number} normX
 * @param {number} normY
 * @returns {import('three').Mesh | null}
 */
export const getHoveredDie = (camera, normX, normY) => {
    if (!raycaster || !mouse) return null;
    mouse.x = normX;
    mouse.y = normY;
    raycaster.setFromCamera(mouse, camera);
    const meshes = spawnedDice.map((d) => d.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
        /** @type {import('three').Object3D | null} */
        let object = intersects[0].object;
        while (object && !object.userData.isDie && !object.userData.body && object.parent) {
            object = object.parent;
        }
        return object?.userData?.isDie || object?.userData?.body
            ? /** @type {import('three').Mesh} */ (object)
            : null;
    }
    return null;
};

/** @type {LevitationState[]} */
const levitatingDice = [];

/**
 * @param {import('three').Mesh} object
 * @param {import('three').Scene} scene
 * @param {AmmoWorld | null | undefined} physicsWorld
 * @param {InteractionHooks} [hooks]
 */
function triggerLevitation(object, scene, physicsWorld, hooks = {}) {
    if (levitatingDice.find((d) => d.object === object)) return;

    const wasmMode = isWasmInteractionMode();
    const body = /** @type {AmmoRigidBody | null | undefined} */ (object.userData.body);

    if (wasmMode) {
        setDiePhysicsAuthority(object, 'wasm');
        setDieWasmKinematic(object, true);
    } else if (body) {
        prepareDieForAmmoInteraction(object);
        body.setCollisionFlags?.((body.getCollisionFlags?.() ?? 0) | 2);
        body.setActivationState?.(4);
    }

    const light = new THREE.PointLight(0x0088ff, 5, 5);
    light.castShadow = true;
    light.shadow.bias = -0.0001;
    light.position.set(0, 0, 0);
    object.add(light);

    levitatingDice.push({
        object,
        body,
        light,
        scene,
        physicsWorld,
        hooks,
        wasm: wasmMode,
        startTime: Date.now(),
        startX: object.position.x,
        startZ: object.position.z,
        startY: object.position.y,
        targetY: object.position.y + 2.0,
        spinQuat: object.quaternion.clone(),
        state: 'lifting',
    });

    if (!wasmMode) setDiePhysicsAuthority(object, 'ammo');
    hooks.onMotionActivityChange?.(true, 'levitation');
}

const _levitationSpinStep = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * @typedef {{ setIdentity(): void, setOrigin(v: unknown): void, setRotation(q: unknown): void }} LevitationTransform
 */

/** @type {LevitationTransform | null} */
let _levitationTransform = null;

function updateLevitation() {
    if (levitatingDice.length === 0) return;

    const now = Date.now();
    const Ammo = getAmmo();

    if (!_levitationTransform && Ammo) {
        _levitationTransform = new Ammo.btTransform();
    }

    for (let i = levitatingDice.length - 1; i >= 0; i--) {
        const item = levitatingDice[i];
        const elapsed = (now - item.startTime) / 1000;

        if (elapsed < 1.5) {
            let currentY = item.startY;
            if (elapsed < 0.5) {
                const t = elapsed / 0.5;
                const ease = t * (2 - t);
                currentY = item.startY + (item.targetY - item.startY) * ease;
            } else {
                currentY = item.targetY;
            }

            if (item.wasm) {
                _levitationSpinStep.setFromAxisAngle(_UP, 0.15);
                item.spinQuat.multiply(_levitationSpinStep);
                driveDieWasmTransform(
                    item.object,
                    { x: item.startX, y: currentY, z: item.startZ },
                    item.spinQuat
                );
                item.object.position.set(item.startX, currentY, item.startZ);
                item.object.quaternion.copy(item.spinQuat);
            } else if (item.body && _levitationTransform && Ammo) {
                item.object.position.y = currentY;
                item.object.rotateY(0.15);

                const p = item.object.position;
                const q = item.object.quaternion;
                _levitationTransform.setIdentity();
                _levitationTransform.setOrigin(new Ammo.btVector3(p.x, p.y, p.z));
                _levitationTransform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
                item.body.setWorldTransform?.(_levitationTransform);
                item.body.getMotionState?.()?.setWorldTransform(_levitationTransform);
            }
        } else {
            if (item.light) {
                item.object.remove(item.light);
                if (item.light.dispose) item.light.dispose();
            }

            const forceX = (Math.random() - 0.5) * 50;
            const forceY = Math.random() * 20 - 10;
            const forceZ = (Math.random() - 0.5) * 50;

            const spinVal = 300;
            const spinX = (Math.random() - 0.5) * spinVal;
            const spinY = (Math.random() - 0.5) * spinVal;
            const spinZ = (Math.random() - 0.5) * spinVal;

            if (item.wasm) {
                setDieWasmKinematic(item.object, false);
                applyWasmImpulseForDie(
                    item.object,
                    { x: forceX, y: forceY, z: forceZ },
                    { x: spinX, y: spinY, z: spinZ }
                );
                setDiePhysicsAuthority(item.object, 'wasm');
            } else if (item.body && Ammo) {
                item.body.setCollisionFlags?.((item.body.getCollisionFlags?.() ?? 0) & ~2);
                item.body.setActivationState?.(1);

                syncDieMeshStateToWasm(item.object);
                applyWasmImpulseForDie(
                    item.object,
                    { x: forceX, y: forceY, z: forceZ },
                    { x: spinX, y: spinY, z: spinZ }
                );
                setDiePhysicsAuthority(item.object, 'wasm');

                item.body.applyCentralImpulse?.(new Ammo.btVector3(forceX, forceY, forceZ));
                item.body.applyTorqueImpulse?.(new Ammo.btVector3(spinX, spinY, spinZ));
            }

            item.hooks?.onMotionActivityChange?.(false, 'levitation');
            levitatingDice.splice(i, 1);
        }
    }
}
