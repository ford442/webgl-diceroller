import { getAmmo } from '../physics.js';

import { isPaletteMaterial } from '../core/MaterialPalette.js';

function resolveRootObject(result) {
    if (!result) return null;
    if (result.isObject3D) return result;
    if (result.group?.isObject3D) return result.group;
    return null;
}

export function destroyPhysicsBody(physicsWorld, body) {
    if (!body || !physicsWorld) return;
    const ammo = getAmmo();
    if (!ammo) return;

    physicsWorld.removeRigidBody(body);
    const motionState = body.getMotionState?.();
    if (motionState) ammo.destroy(motionState);
    ammo.destroy(body);
}

export function disposeObject3D(root, physicsWorld) {
    if (!root?.isObject3D) return;

    const bodies = new Set();
    root.traverse((obj) => {
        if (obj.userData?.physicsBody) bodies.add(obj.userData.physicsBody);
        // InstancedMesh-style props store their per-instance static bodies here.
        if (Array.isArray(obj.userData?.physicsBodies)) {
            for (const body of obj.userData.physicsBodies) {
                if (body) bodies.add(body);
            }
        }
    });

    root.parent?.remove(root);

    root.traverse((obj) => {
        if (!obj.isMesh) return;
        // Frees per-instance attribute buffers (instanceMatrix / instanceColor).
        if (obj.isInstancedMesh) obj.dispose?.();
        obj.geometry?.dispose?.();
        const material = obj.material;
        if (Array.isArray(material)) {
            material.forEach((mat) => {
                if (!isPaletteMaterial(mat)) mat?.dispose?.();
            });
        } else if (!isPaletteMaterial(material)) {
            material?.dispose?.();
        }
    });

    for (const body of bodies) {
        destroyPhysicsBody(physicsWorld, body);
    }
}

export function disposePropSpawn(record, physicsWorld) {
    if (!record) return;

    record.updateHandle?.dispose?.();
    record.disposers?.forEach((fn) => fn());

    const result = record.result;
    if (!result) return;

    if (result.physicsBody || result.body) {
        destroyPhysicsBody(physicsWorld, result.physicsBody ?? result.body);
    }

    const root = resolveRootObject(result);
    if (root) disposeObject3D(root, physicsWorld);
    else if (result.isObject3D) disposeObject3D(result, physicsWorld);

    if (Array.isArray(result.disposableRoots)) {
        for (const extra of result.disposableRoots) {
            disposeObject3D(extra, physicsWorld);
        }
    }
}
