import * as THREE from 'three';

/** @enum {number} */
export const STATIC_MATERIAL = {
    DEFAULT: 0,
    VELVET: 1,
    WOOD: 2,
    METAL: 3,
    LEATHER: 4,
};

let nextAutoStaticId = 10000;

export function allocStaticColliderId() {
    return nextAutoStaticId++;
}

export function resetStaticColliderIds(seed = 10000) {
    nextAutoStaticId = seed;
}

/**
 * @param {object} bodyDef
 * @returns {number}
 */
function materialTagForBodyDef(bodyDef) {
    if (bodyDef.materialTag != null) return bodyDef.materialTag;
    if (bodyDef.restitution != null && bodyDef.restitution <= 0.1) return STATIC_MATERIAL.VELVET;
    return STATIC_MATERIAL.WOOD;
}

function vec3From(value = {}) {
    if (Array.isArray(value)) {
        return { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 };
    }
    return {
        x: value.x ?? 0,
        y: value.y ?? 0,
        z: value.z ?? 0,
    };
}

/**
 * @param {import('three').Object3D} anchor
 * @param {{ offset?: { x?: number; y?: number; z?: number } | number[]; rotation?: { x?: number; y?: number; z?: number } | number[] }} spec
 */
export function computeWorldPose(anchor, spec = {}) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    anchor.updateWorldMatrix?.(true, false);
    anchor.getWorldPosition(position);
    anchor.getWorldQuaternion(quaternion);

    const offset = vec3From(spec.offset ?? {});
    if (offset.x || offset.y || offset.z) {
        const local = new THREE.Vector3(offset.x, offset.y, offset.z);
        local.applyQuaternion(quaternion);
        position.add(local);
    }

    const rotation = vec3From(spec.rotation ?? {});
    if (rotation.x || rotation.y || rotation.z) {
        const localQuat = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(rotation.x, rotation.y, rotation.z)
        );
        quaternion.multiply(localQuat);
    }

    return { position, quaternion };
}

/**
 * @param {import('./physicsTypes').PhysicsEngine} engine
 * @param {import('../types/staticCollider').StaticColliderSpec} spec
 * @param {{ position: THREE.Vector3; quaternion: THREE.Quaternion }} worldPose
 * @returns {number}
 */
export function addStaticColliderToEngine(engine, spec, worldPose) {
    const id = spec.id ?? allocStaticColliderId();
    const materialTag = spec.materialTag ?? STATIC_MATERIAL.DEFAULT;
    const px = worldPose.position.x;
    const py = worldPose.position.y;
    const pz = worldPose.position.z;
    const qx = worldPose.quaternion.x;
    const qy = worldPose.quaternion.y;
    const qz = worldPose.quaternion.z;
    const qw = worldPose.quaternion.w;

    switch (spec.type) {
        case 'box': {
            const [hx, hy, hz] = spec.halfExtents;
            return engine.addStaticBox(id, px, py, pz, hx, hy, hz, qx, qy, qz, qw, materialTag);
        }
        case 'plane': {
            const n = spec.normal;
            return engine.addStaticPlane(id, n.x, n.y, n.z, spec.dist, materialTag);
        }
        case 'cylinder':
        case 'openCylinder':
            return engine.addStaticOpenCylinder(
                id,
                px,
                py,
                pz,
                spec.radius,
                spec.halfHeight ?? (spec.height != null ? spec.height / 2 : 0),
                spec.segments ?? 16,
                !!spec.closedBottom,
                materialTag
            );
        case 'convexHull': {
            const flat = spec.vertices.flat();
            return engine.addStaticConvexHull(id, px, py, pz, qx, qy, qz, qw, flat, materialTag);
        }
        default: {
            const unsupported = /** @type {{ type?: string }} */ (spec).type;
            console.warn(`staticColliders: unsupported type "${unsupported}"`);
            return -1;
        }
    }
}

/**
 * Register table physics bodies from Table.js config into the WASM static registry.
 * @param {import('./physicsTypes').PhysicsEngine} engine
 * @param {object | null | undefined} tableConfig
 * @returns {number} colliders added
 */
export function createWasmTableBoundsForEngine(engine, tableConfig) {
    if (!engine?.addStaticBox || !engine.clearStatics) return 0;

    engine.clearStatics();
    resetStaticColliderIds(1);

    const bodies = tableConfig?.physicsBodies ?? [];
    let added = 0;
    for (const bodyDef of bodies) {
        if (bodyDef.type !== 'box') continue;
        const id = added + 1;
        const materialTag = materialTagForBodyDef(bodyDef);
        const result = engine.addStaticBox(
            id,
            bodyDef.position.x,
            bodyDef.position.y,
            bodyDef.position.z,
            bodyDef.size.x / 2,
            bodyDef.size.y / 2,
            bodyDef.size.z / 2,
            0,
            0,
            0,
            1,
            materialTag
        );
        if (result >= 0) added++;
    }
    return added;
}

/**
 * @param {import('./physicsTypes').PhysicsEngine} engine
 * @param {import('../types/staticCollider').StaticColliderSpec} spec
 * @param {import('three').Object3D} anchor
 * @returns {number}
 */
export function addStaticColliderForEngine(engine, spec, anchor) {
    if (!engine) return -1;
    const worldPose = computeWorldPose(anchor, spec);
    return addStaticColliderToEngine(engine, spec, worldPose);
}

export function removeStaticColliderForEngine(engine, userId) {
    return !!engine?.removeStatic?.(userId);
}

export function clearStaticCollidersForEngine(engine) {
    engine?.clearStatics?.();
}
