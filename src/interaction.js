import * as THREE from 'three';
import { getAmmo } from './physics.js';
import { spawnedDice } from './dice.js';

let raycaster;
let mouse;
let draggedItem = null;
let dragConstraint = null;
let dragPlane = null;
let dragOffset = new THREE.Vector3();

// Plane for raycasting movement
const planeNormal = new THREE.Vector3(0, 1, 0);
const planeConstant = 0; // Will be updated based on drag height

export const initInteraction = (camera, scene, canvas, physicsWorld) => {
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Create a virtual plane for dragging
    // We can just use math, but sometimes a visual helper is useful for debugging.
    // For now, mathematical plane.

    canvas.addEventListener('pointerdown', (event) => onPointerDown(event, camera, scene, physicsWorld));
    window.addEventListener('pointermove', (event) => onPointerMove(event, camera));
    window.addEventListener('pointerup', () => onPointerUp(physicsWorld));
};

function onPointerDown(event, camera, scene, physicsWorld) {
    if (event.button !== 0) return; // Only left click

    updateMouse(event);
    raycaster.setFromCamera(mouse, camera);

    // Get meshes from spawnedDice
    const meshes = spawnedDice.map(d => d.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        // Disable orbit controls if present (not implemented yet, but good practice)
        // document.body.style.cursor = 'grabbing';

        const intersect = intersects[0];
        const object = intersect.object;
        const point = intersect.point;

        if (object.userData.body) {
            draggedItem = object;
            startDrag(object.userData.body, point, physicsWorld);
        }
    }
}

function onPointerMove(event, camera) {
    updateMouse(event);

    if (dragConstraint) {
        raycaster.setFromCamera(mouse, camera);

        // We drag on a plane parallel to the floor at the height of the grab point
        // Or a plane perpendicular to camera? Parallel to floor is usually better for table-top.
        // Let's drag on a plane at the current height of the object (or the grab point height).

        // Create a plane at the drag height
        const targetDistance = raycaster.ray.origin.y / -raycaster.ray.direction.y; // Intersection with y=0 plane relative to camera

        // We want to intersect with a plane at height `dragHeight`
        // ray.origin + t * ray.direction = point
        // point.y = dragHeight
        // t = (dragHeight - ray.origin.y) / ray.direction.y

        // But we want to maintain the offset from the camera to the object?
        // Simple approach: move the pivot point to the ray intersection with a horizontal plane
        // passing through the initial grab point.

        // However, if we look from above, we want x/z movement.
        // If we look from side, we might want y movement.
        // Let's stick to X/Z movement at fixed Y (lift it slightly).

        // Actually, let's allow lifting.
        // Common strategy: intersection with a plane parallel to camera view plane.

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
        // document.body.style.cursor = 'auto';
    }
}

function updateMouse(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function startDrag(body, point, physicsWorld) {
    const Ammo = getAmmo();

    // Convert point to local coordinates of body
    // actually btPoint2PointConstraint can take world coordinates for the second pivot

    // Pivot A is in body local space
    // Pivot B is in world space (initially same as world pos of pivot A)

    const bodyTransform = body.getWorldTransform();
    const invBodyTransform = new Ammo.btTransform();
    invBodyTransform.setIdentity();
    // Invert the body transform to get world-to-local
    // Ammo.js doesn't have inverse() on transform easily accessible usually,
    // better to use inverse of rotation and negative translation.

    // Wait, btPoint2PointConstraint constructor:
    // (rigidBodyA, pivotInA) -> uses current body position as pivot B world pos

    const localPivot = new Ammo.btVector3(point.x, point.y, point.z);

    // To get local pivot: transform point by inverse of body transform
    const origin = bodyTransform.getOrigin();
    const rotation = bodyTransform.getRotation(); // quaternion

    // We can just rely on the fact that we have the world point.
    // Let's use the two-argument constructor if available?
    // btPoint2PointConstraint(rbA, pivotInA)

    // We need pivotInA.
    // Vector3 localPoint = mesh.worldToLocal(point.clone());
    const localPointThree = draggedItem.worldToLocal(point.clone());
    const localPivotAmmo = new Ammo.btVector3(localPointThree.x, localPointThree.y, localPointThree.z);

    dragConstraint = new Ammo.btPoint2PointConstraint(body, localPivotAmmo);

    // Make the constraint stronger?
    dragConstraint.m_setting.m_impulseClamp = 100; // default is 0 (unlimited?) check ammo docs or source
    // Actually default impulse clamp is 0, which means no clamp.
    // Usually we want to increase tau (strength) and damping.
    dragConstraint.m_setting.m_tau = 0.001;
    dragConstraint.m_setting.m_damping = 1.0;
    // Values might need tuning.

    physicsWorld.addConstraint(dragConstraint);

    // Body needs to be active to move
    body.activate();
}

export const updateInteraction = () => {
    // Nothing to do in loop if we update on mouse move,
    // unless we want to smooth things out.
    // But we need to make sure dragged body stays active.
    if (draggedItem && draggedItem.userData.body) {
        draggedItem.userData.body.activate();
    }
};
