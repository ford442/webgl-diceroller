import { getAmmo } from '../physics.js';

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
    });

    root.parent?.remove(root);

    root.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.geometry?.dispose?.();
        const material = obj.material;
        if (Array.isArray(material)) material.forEach((mat) => mat?.dispose?.());
        else material?.dispose?.();
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
