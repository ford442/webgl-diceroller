import * as THREE from 'three';
import { getAmmo } from './physics.js';
import { spawnedDice } from './dice.js';

let raycaster;
let mouse;
let draggedItem = null;
let dragConstraint = null;

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
};
