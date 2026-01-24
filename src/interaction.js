import * as THREE from 'three';
import { getAmmo } from './physics.js';
import { spawnedDice } from './dice.js';

let raycaster;
let mouse;
let draggedItem = null;
let dragConstraint = null;

let lastClickTime = 0;
let lastClickObject = null;
const DOUBLE_CLICK_DELAY = 300;

export const initInteraction = (camera, scene, physicsWorld) => {
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    return {
        handleDown: (x, y) => onPointerDown(x, y, camera, scene, physicsWorld),
        handleMove: (x, y) => onPointerMove(x, y, camera),
        handleUp: () => onPointerUp(physicsWorld)
    };
};

function onPointerDown(x, y, camera, scene, physicsWorld) {
    updateMouse(x, y);
    raycaster.setFromCamera(mouse, camera);

    // Get meshes from spawnedDice
    const meshes = spawnedDice.map(d => d.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        const object = intersect.object;
        const point = intersect.point;

        if (object.userData.body) {
            const now = Date.now();
            if (lastClickObject === object && (now - lastClickTime) < DOUBLE_CLICK_DELAY) {
                // Double click detected
                triggerLevitation(object, scene, physicsWorld);
                lastClickObject = null;
                lastClickTime = 0;
                return;
            }

            lastClickTime = now;
            lastClickObject = object;

            draggedItem = object;
            startDrag(object.userData.body, point, physicsWorld);
        }
    }
}

function onPointerMove(x, y, camera) {
    updateMouse(x, y);

    if (dragConstraint) {
        raycaster.setFromCamera(mouse, camera);

        // Create a plane parallel to the camera view plane at the object's position
        const plane = new THREE.Plane();
        plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), draggedItem.position);

        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, target);

        if (target) {
            const Ammo = getAmmo();
            // Update constraint pivot B (which is in world space for p2p)
            dragConstraint.setPivotB(new Ammo.btVector3(target.x, target.y, target.z));
        }
    }
}

function onPointerUp(physicsWorld) {
    if (dragConstraint) {
        const Ammo = getAmmo();
        physicsWorld.removeConstraint(dragConstraint);
        Ammo.destroy(dragConstraint);
        dragConstraint = null;
        draggedItem = null;
    }
}

function updateMouse(x, y) {
    // x and y are assumed to be Normalized Device Coordinates (-1 to +1)
    // passed directly from the main loop which calculates them from the crosshair position
    mouse.x = x;
    mouse.y = y;
}

function startDrag(body, point, physicsWorld) {
    const Ammo = getAmmo();
    const localPointThree = draggedItem.worldToLocal(point.clone());
    const localPivotAmmo = new Ammo.btVector3(localPointThree.x, localPointThree.y, localPointThree.z);

    dragConstraint = new Ammo.btPoint2PointConstraint(body, localPivotAmmo);

    // Make the constraint stronger
    const setting = (typeof dragConstraint.get_m_setting === 'function') ? dragConstraint.get_m_setting() : (dragConstraint.m_setting || null);
    if (setting) {
        if (typeof setting.set_m_impulseClamp === 'function') {
            setting.set_m_impulseClamp(100);
            setting.set_m_tau(0.001);
            setting.set_m_damping(1.0);
        } else {
            setting.m_impulseClamp = 100;
            setting.m_tau = 0.001;
            setting.m_damping = 1.0;
        }
    }

    physicsWorld.addConstraint(dragConstraint);
    body.activate();
}

export const updateInteraction = () => {
    if (draggedItem && draggedItem.userData.body) {
        draggedItem.userData.body.activate();
    }
    updateLevitation();
};

const levitatingDice = [];

function triggerLevitation(object, scene, physicsWorld) {
    if (levitatingDice.find(d => d.object === object)) return;

    const body = object.userData.body;
    const Ammo = getAmmo();

    // Switch to Kinematic so we can control position manually
    body.setCollisionFlags(body.getCollisionFlags() | 2); // CF_KINEMATIC_OBJECT
    body.setActivationState(4); // DISABLE_DEACTIVATION

    // Create Blue Light
    const light = new THREE.PointLight(0x0088ff, 5, 5);
    light.castShadow = true;
    light.shadow.bias = -0.0001;
    light.position.set(0, 0, 0);
    object.add(light);

    levitatingDice.push({
        object: object,
        body: body,
        light: light,
        scene: scene,
        physicsWorld: physicsWorld,
        startTime: Date.now(),
        startY: object.position.y,
        targetY: object.position.y + 2.0,
        state: 'lifting'
    });
}

function updateLevitation() {
    if (levitatingDice.length === 0) return;

    const now = Date.now();
    const Ammo = getAmmo();
    const transform = new Ammo.btTransform();

    for (let i = levitatingDice.length - 1; i >= 0; i--) {
        const item = levitatingDice[i];
        const elapsed = (now - item.startTime) / 1000;

        if (elapsed < 1.5) {
            // Lifting (0-0.5s) or Hovering (0.5-1.5s)
            let currentY = item.startY;
            if (elapsed < 0.5) {
                const t = elapsed / 0.5;
                const ease = t * (2 - t); // Ease out quad
                currentY = item.startY + (item.targetY - item.startY) * ease;
            } else {
                currentY = item.targetY;
            }

            // Update Mesh Position
            item.object.position.y = currentY;

            // Spin Mesh
            item.object.rotateY(0.15); // Spin speed

            // Sync Body to Mesh
            const p = item.object.position;
            const q = item.object.quaternion;

            transform.setIdentity();
            transform.setOrigin(new Ammo.btVector3(p.x, p.y, p.z));
            transform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
            item.body.getMotionState().setWorldTransform(transform);

        } else {
            // Release
            if (item.light) {
                item.object.remove(item.light);
                if (item.light.dispose) item.light.dispose();
            }

            // Reset Physics
            item.body.setCollisionFlags(item.body.getCollisionFlags() & ~2); // Remove Kinematic
            item.body.setActivationState(1); // ACTIVE_TAG

            // Random Throw
            // Reuse logic similar to throwDice but weaker
            const forceX = (Math.random() - 0.5) * 50;
            const forceY = Math.random() * 20 - 10;
            const forceZ = (Math.random() - 0.5) * 50;

            const spinVal = 300;
            const spinX = (Math.random() - 0.5) * spinVal;
            const spinY = (Math.random() - 0.5) * spinVal;
            const spinZ = (Math.random() - 0.5) * spinVal;

            item.body.applyCentralImpulse(new Ammo.btVector3(forceX, forceY, forceZ));
            item.body.applyTorqueImpulse(new Ammo.btVector3(spinX, spinY, spinZ));

            levitatingDice.splice(i, 1);
        }
    }

    Ammo.destroy(transform);
}
