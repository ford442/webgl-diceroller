/**
 * Visual sync + grab-driver primitives for dynamic (movable) props — the
 * prop-side counterpart of dice/DiceSync.js. A dynamic prop's THREE.Group
 * root carries its physics handle in userData (`wasmDynamicIds`), set by
 * StaticColliderBridge.js's createDynamicCollider().
 */
import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { isUsingWasmPhysics } from '../dice/DicePhysicsPresets.js';
import { spawnedProps } from './DynamicPropState.js';

const DYN_TRANSFORM_STRIDE = 7;

/** @param {import('three').Object3D | null | undefined} mesh */
export const findSpawnedPropByMesh = (mesh) => spawnedProps.find((g) => g === mesh) || null;

/**
 * Map a WASM dynamic-body userId (as seen in a collision event) back to its
 * prop group, for audio position enrichment.
 * @param {number} id
 */
export const findSpawnedPropByPhysicsId = (id) => {
    if (id == null || id < 0) return null;
    for (const group of spawnedProps) {
        if (group.userData.wasmDynamicIds?.includes(id)) return group;
    }
    return null;
};

function wasmIdForGroup(group) {
    const ids = group.userData.wasmDynamicIds;
    return ids && ids.length ? ids[0] : null;
}

export const updatePropVisuals = () => {
    if (spawnedProps.length === 0 || !isUsingWasmPhysics()) return;

    const engine = getWasmEngine();
    if (typeof engine.getDynamicTransforms !== 'function') return;
    const transforms = engine.getDynamicTransforms();
    const ids = engine.getDynamicIds();
    if (!ids || !ids.length) return;

    for (const group of spawnedProps) {
        const targetId = wasmIdForGroup(group);
        if (targetId == null) continue;

        let offset = -1;
        for (let i = 0; i < ids.length; i++) {
            if (Math.round(ids[i]) === targetId) {
                offset = i * DYN_TRANSFORM_STRIDE;
                break;
            }
        }
        if (offset < 0 || offset + (DYN_TRANSFORM_STRIDE - 1) >= transforms.length) continue;

        group.position.set(transforms[offset + 0], transforms[offset + 1], transforms[offset + 2]);
        group.quaternion.set(
            transforms[offset + 3],
            transforms[offset + 4],
            transforms[offset + 5],
            transforms[offset + 6]
        );
    }
};

// --- WasmDieGrab.js driver: kinematic-while-held, impulse-on-release ------

export const setPropWasmKinematic = (mesh, kinematic) => {
    const group = findSpawnedPropByMesh(mesh);
    const targetId = group && wasmIdForGroup(group);
    if (!isUsingWasmPhysics() || targetId == null) return;
    getWasmEngine().setDynamicKinematic(targetId, kinematic);
};

export const drivePropWasmTransform = (mesh, position, quaternion) => {
    const group = findSpawnedPropByMesh(mesh);
    const targetId = group && wasmIdForGroup(group);
    if (!isUsingWasmPhysics() || targetId == null) return;
    getWasmEngine().setDynamicTransform(
        targetId,
        position.x,
        position.y,
        position.z,
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w
    );
};

export const applyWasmImpulseForProp = (mesh, impulse, torque) => {
    const group = findSpawnedPropByMesh(mesh);
    const targetId = group && wasmIdForGroup(group);
    if (!isUsingWasmPhysics() || targetId == null) return;
    const engine = getWasmEngine();
    if (impulse) engine.applyDynamicImpulse(targetId, impulse.x, impulse.y, impulse.z);
    if (torque) engine.applyDynamicTorqueImpulse(targetId, torque.x, torque.y, torque.z);
};

export const propWasmGrabDriver = {
    setKinematic: setPropWasmKinematic,
    driveTransform: drivePropWasmTransform,
    applyImpulse: applyWasmImpulseForProp,
};
