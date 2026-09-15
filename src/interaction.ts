import * as THREE from 'three';
import {
    spawnedDice,
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
import { spawnedProps } from './environment/DynamicPropState.js';
import { propWasmGrabDriver } from './environment/DynamicPropSync.js';
import type { InteractionHooks } from './types/interaction.js';

interface InteractiveObjectEntry {
    mesh: THREE.Object3D;
    callback: () => void;
}

interface _LevitationState {
    object: THREE.Mesh;
    light: THREE.PointLight;
    scene: THREE.Scene;
    hooks: InteractionHooks;
    startTime: number;
    startX: number;
    startZ: number;
    startY: number;
    targetY: number;
    spinQuat: THREE.Quaternion;
    state: 'lifting';
}

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
 * @property {import('three').PointLight} light
 * @property {import('three').Scene} scene
 * @property {InteractionHooks} hooks
 * @property {number} startTime
 * @property {number} startX
 * @property {number} startZ
 * @property {number} startY
 * @property {number} targetY
 * @property {import('three').Quaternion} spinQuat
 * @property {'lifting'} state
 */

/** @type {import('three').Raycaster | undefined} */
let raycaster: any;
let mouse: any;
const prevMouse = new THREE.Vector2(0, 0);
let draggedItem: any = null;

const wasmGrab = createWasmDieGrabState();

let lastClickTime = 0;
/** @type {import('three').Object3D | null} */
let lastClickObject: THREE.Object3D | null = null;
const DOUBLE_CLICK_DELAY = 300;

/** @type {InteractiveObjectEntry[]} */
const interactiveObjects: InteractiveObjectEntry[] = [];

/**
 * @param {import('three').Camera} camera
 * @param {import('three').Scene} scene
 * @param {unknown} physicsWorld unused — kept for call-site compatibility
 * @param {InteractionHooks} [hooks]
 */
export const initInteraction = (camera: any, scene: any, physicsWorld: any, hooks: any = {}) => {
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
        handleDown: (x: number, y: number) => onPointerDown(x, y, camera, scene, hooks),
        handleMove: (x: number, y: number) => onPointerMove(x, y, camera),
        handleUp: () => onPointerUp(hooks),
    };
};

/**
 * @param {import('three').Object3D} mesh
 * @param {() => void} callback
 */
export const registerInteractiveObject = (mesh: any, callback: any) => {
    interactiveObjects.push({ mesh, callback });
};

/** @param {import('three').Object3D} mesh */
export const unregisterInteractiveObject = (mesh: any) => {
    const index = interactiveObjects.findIndex((entry) => entry.mesh === mesh);
    if (index >= 0) interactiveObjects.splice(index, 1);
};

/**
 * @param {number} x
 * @param {number} y
 * @param {import('three').Camera} camera
 * @param {import('three').Scene} scene
 * @param {InteractionHooks} [hooks]
 */
function onPointerDown(x: any, y: any, camera: any, scene: any, hooks: any = {}) {
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

        while (object && !object.userData.isDie && object.parent) {
            object = object.parent;
        }

        if (object && object.userData.isDie) {
            const now = Date.now();
            if (lastClickObject === object && now - lastClickTime < DOUBLE_CLICK_DELAY) {
                triggerLevitation(/** @type {import('three').Mesh} */ object, scene, hooks);
                lastClickObject = null;
                lastClickTime = 0;
                return;
            }

            lastClickTime = now;
            lastClickObject = object;

            draggedItem = /** @type {import('three').Mesh} */ object;
            hooks.onMotionActivityChange?.(true, 'drag');
            startWasmDieGrab(wasmGrab, draggedItem, point);
        }
        return;
    }

    // Dynamic (knockable) props opt into the same kinematic grab helper dice use.
    if (spawnedProps.length > 0) {
        const propIntersects = raycaster.intersectObjects(spawnedProps, true);
        if (propIntersects.length > 0) {
            const intersect = propIntersects[0];
            /** @type {import('three').Object3D | null} */
            let object = intersect.object;
            const point = intersect.point;

            while (object && !object.userData.isDynamicProp && object.parent) {
                object = object.parent;
            }

            if (object && object.userData.isDynamicProp) {
                draggedItem = /** @type {import('three').Mesh} */ object;
                hooks.onMotionActivityChange?.(true, 'drag');
                startWasmDieGrab(wasmGrab, draggedItem, point, propWasmGrabDriver);
            }
        }
    }
}

/**
 * @param {import('three').Object3D} child @param {import('three').Object3D} parent
 */
function isDescendant(child: any, parent: any) {
    let curr = child.parent;
    while (curr) {
        if (curr === parent) return true;
        curr = curr.parent;
    }
    return false;
}

/** @param {number} x @param {number} y @param {import('three').Camera} camera */
function onPointerMove(x: any, y: any, camera: any) {
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
    }
}

/** @param {import('three').Camera} camera @returns {import('three').Vector3 | null} */
function projectCursorToDiePlane(camera: any) {
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

/** @param {InteractionHooks} [hooks] */
function onPointerUp(hooks: any = {}) {
    getDiceCupController()?.handlePointerUp();

    if (wasmGrab.active) {
        endWasmDieGrab(wasmGrab, {
            onReleased: () => hooks.onMotionActivityChange?.(false, 'drag'),
        });
        draggedItem = null;
    }
}

/** @param {number} x @param {number} y */
function updateMouse(x: any, y: any) {
    if (!mouse) return;
    mouse.x = x;
    mouse.y = y;
}

/** @param {number} [deltaTime] */
export const updateInteraction = (deltaTime: any = 1 / 60) => {
    if (wasmGrab.active) {
        updateWasmDieGrab(wasmGrab, deltaTime);
    }
    updateLevitation();
};

export const isDragging = () => draggedItem !== null;
export const hasActiveDiceInteraction = () => draggedItem !== null || levitatingDice.length > 0;

/**
 * @param {import('three').Camera} camera
 * @param {number} normX
 * @param {number} normY
 */
export const isHoveringOverDice = (camera: any, normX: any, normY: any) => {
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
export const getHoveredDie = (camera: any, normX: any, normY: any) => {
    if (!raycaster || !mouse) return null;
    mouse.x = normX;
    mouse.y = normY;
    raycaster.setFromCamera(mouse, camera);
    const meshes = spawnedDice.map((d) => d.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
        /** @type {import('three').Object3D | null} */
        let object = intersects[0].object;
        while (object && !object.userData.isDie && object.parent) {
            object = object.parent;
        }
        return object?.userData?.isDie ? /** @type {import('three').Mesh} */ object : null;
    }
    return null;
};

/** @type {LevitationState[]} */
const levitatingDice: any[] = [];

/**
 * @param {import('three').Mesh} object
 * @param {import('three').Scene} scene
 * @param {InteractionHooks} [hooks]
 */
function triggerLevitation(object: any, scene: any, hooks: any = {}) {
    if (levitatingDice.find((d) => d.object === object)) return;

    setDieWasmKinematic(object, true);

    const light = new THREE.PointLight(0x0088ff, 5, 5);
    light.castShadow = true;
    light.shadow.bias = -0.0001;
    light.position.set(0, 0, 0);
    object.add(light);

    levitatingDice.push({
        object,
        light,
        scene,
        hooks,
        startTime: Date.now(),
        startX: object.position.x,
        startZ: object.position.z,
        startY: object.position.y,
        targetY: object.position.y + 2.0,
        spinQuat: object.quaternion.clone(),
        state: 'lifting',
    });

    hooks.onMotionActivityChange?.(true, 'levitation');
}

const _levitationSpinStep = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

function updateLevitation() {
    if (levitatingDice.length === 0) return;

    const now = Date.now();

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

            _levitationSpinStep.setFromAxisAngle(_UP, 0.15);
            item.spinQuat.multiply(_levitationSpinStep);
            driveDieWasmTransform(
                item.object,
                { x: item.startX, y: currentY, z: item.startZ },
                item.spinQuat
            );
            item.object.position.set(item.startX, currentY, item.startZ);
            item.object.quaternion.copy(item.spinQuat);
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

            setDieWasmKinematic(item.object, false);
            applyWasmImpulseForDie(
                item.object,
                { x: forceX, y: forceY, z: forceZ },
                { x: spinX, y: spinY, z: spinZ }
            );

            item.hooks?.onMotionActivityChange?.(false, 'levitation');
            levitatingDice.splice(i, 1);
        }
    }
}
