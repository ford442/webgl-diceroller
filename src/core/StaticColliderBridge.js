import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';
import { destroyPhysicsBody } from '../environment/PropLifecycle.js';
import {
    addStaticCollider as wasmAddStaticCollider,
    getWasmEngine,
    isWasmAvailable,
    removeStaticCollider as wasmRemoveStaticCollider,
} from '../wasm/PhysicsBridge.js';

// getStaticCapacityDroppedCount() is only synchronously meaningful on the
// non-worker bridge (worker addStatic* commands are fire-and-forget and
// always return -1) — undefined there, so this stays silent on the default
// worker path. Warn once per new drop rather than once per collider so a
// dense layout doesn't spam the console.
let lastWarnedStaticCapacityDropped = 0;

function warnOnStaticCapacityDrop(anchor) {
    const dropped = getWasmEngine?.()?.getStaticCapacityDroppedCount?.();
    if (!dropped || dropped <= lastWarnedStaticCapacityDropped) return;
    lastWarnedStaticCapacityDropped = dropped;
    const label = anchor?.name || anchor?.userData?.propName || 'unknown prop';
    console.warn(
        `StaticColliderBridge: MAX_STATICS capacity reached — ${dropped} static ` +
            `collider(s) dropped so far (most recently while registering "${label}").`
    );
}

/** @typedef {import('../types/staticCollider').StaticColliderSpec} StaticColliderSpec */

/** @returns {'ammo' | 'wasm'} */
export function getStaticColliderBackend() {
    return isWasmAvailable() ? 'wasm' : 'ammo';
}

function vec3FromSpec(value = {}) {
    return {
        x: value.x ?? 0,
        y: value.y ?? 0,
        z: value.z ?? 0,
    };
}

function applyLocalOffsetToProxy(anchor, proxy, offset, rotation) {
    proxy.position.copy(anchor.position);
    proxy.quaternion.copy(anchor.quaternion);

    const localOffset = vec3FromSpec(offset);
    if (localOffset.x || localOffset.y || localOffset.z) {
        const worldOffset = new THREE.Vector3(localOffset.x, localOffset.y, localOffset.z);
        worldOffset.applyQuaternion(anchor.quaternion);
        proxy.position.add(worldOffset);
    }

    const localRotation = vec3FromSpec(rotation);
    if (localRotation.x || localRotation.y || localRotation.z) {
        const localQuat = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(localRotation.x, localRotation.y, localRotation.z)
        );
        proxy.quaternion.multiply(localQuat);
    }
}

function addVec3(base, delta) {
    const a = vec3FromSpec(base);
    const b = vec3FromSpec(delta);
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function addEuler(base, delta) {
    const a = vec3FromSpec(base);
    const b = vec3FromSpec(delta);
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Flatten compound specs into leaf colliders with merged local pose.
 * @param {StaticColliderSpec | { type: string, parts?: StaticColliderSpec[], offset?: object, rotation?: object, materialTag?: number }} spec
 * @returns {StaticColliderSpec[]}
 */
export function flattenColliderSpecs(spec) {
    if (!spec) return [];
    if (spec.type === 'compound') {
        const merged = [];
        for (const part of spec.parts ?? []) {
            for (const leaf of flattenColliderSpecs(part)) {
                merged.push({
                    ...leaf,
                    offset: addVec3(spec.offset, leaf.offset),
                    rotation: addEuler(spec.rotation, leaf.rotation),
                    materialTag: leaf.materialTag ?? spec.materialTag,
                });
            }
        }
        return merged;
    }
    return [/** @type {StaticColliderSpec} */ (spec)];
}

function buildAmmoShape(ammo, spec) {
    switch (spec.type) {
        case 'box': {
            const [hx, hy, hz] = spec.halfExtents;
            const halfExtents = new ammo.btVector3(hx, hy, hz);
            const shape = new ammo.btBoxShape(halfExtents);
            ammo.destroy(halfExtents);
            return shape;
        }
        case 'cylinder':
        case 'openCylinder': {
            const halfHeight = spec.halfHeight ?? (spec.height != null ? spec.height / 2 : 0);
            const halfExtents = new ammo.btVector3(spec.radius, halfHeight, spec.radius);
            const shape = new ammo.btCylinderShape(halfExtents);
            ammo.destroy(halfExtents);
            return shape;
        }
        case 'plane': {
            const normal = vec3FromSpec(spec.normal);
            const shape = new ammo.btStaticPlaneShape(
                new ammo.btVector3(normal.x, normal.y, normal.z),
                spec.dist ?? 0
            );
            return shape;
        }
        case 'convexHull': {
            const shape = new ammo.btConvexHullShape();
            for (const vertex of spec.vertices ?? []) {
                const [x = 0, y = 0, z = 0] = vertex;
                shape.addPoint(new ammo.btVector3(x, y, z), false);
            }
            shape.setMargin(0.01);
            return shape;
        }
        case 'compound': {
            const compoundShape = new ammo.btCompoundShape();
            for (const part of spec.parts ?? []) {
                const childShape = buildAmmoShape(ammo, part);
                const transform = new ammo.btTransform();
                transform.setIdentity();

                const offset = vec3FromSpec(part.offset);
                if (offset.x || offset.y || offset.z) {
                    transform.setOrigin(new ammo.btVector3(offset.x, offset.y, offset.z));
                }

                const rotation = vec3FromSpec(part.rotation);
                if (rotation.x || rotation.y || rotation.z) {
                    const quat = new THREE.Quaternion().setFromEuler(
                        new THREE.Euler(rotation.x, rotation.y, rotation.z)
                    );
                    transform.setRotation(new ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
                }

                compoundShape.addChildShape(transform, childShape);
                ammo.destroy(transform);
            }
            return compoundShape;
        }
        default:
            console.warn(`StaticColliderBridge: unsupported collider type "${spec.type}"`);
            return null;
    }
}

function needsPoseProxy(spec) {
    const offset = vec3FromSpec(spec.offset);
    const rotation = vec3FromSpec(spec.rotation);
    return Boolean(offset.x || offset.y || offset.z || rotation.x || rotation.y || rotation.z);
}

function attachBodyToAnchor(anchor, body) {
    if (!body) return;

    if (!Array.isArray(anchor.userData.physicsBodies)) {
        anchor.userData.physicsBodies = [];
    }
    anchor.userData.physicsBodies.push(body);

    if (!anchor.userData.physicsBody) {
        anchor.userData.physicsBody = body;
    }
}

function attachWasmIdToAnchor(anchor, wasmId) {
    if (wasmId == null || wasmId < 0) return;
    if (!Array.isArray(anchor.userData.wasmStaticIds)) {
        anchor.userData.wasmStaticIds = [];
    }
    anchor.userData.wasmStaticIds.push(wasmId);
}

/**
 * Create a static collider from a declarative spec.
 * Uses WASM when available; falls back to ammo.js static bodies.
 *
 * @returns {{ body?: object, shapes?: object[], wasmId?: number } | null}
 */
export function createStaticCollider(physicsWorld, anchor, spec) {
    if (!anchor || !spec) return null;

    const leaves = flattenColliderSpecs(spec);
    if (leaves.length === 0) return null;

    if (getStaticColliderBackend() === 'wasm') {
        let first = null;
        for (const leaf of leaves) {
            const wasmId = wasmAddStaticCollider(leaf, anchor);
            if (wasmId < 0) continue;
            attachWasmIdToAnchor(anchor, wasmId);
            if (!first) first = { wasmId };
        }
        warnOnStaticCapacityDrop(anchor);
        return first;
    }

    if (!physicsWorld) return null;

    const ammo = getAmmo();
    if (!ammo) return null;

    let first = null;
    for (const leaf of leaves) {
        const shape = buildAmmoShape(ammo, leaf);
        if (!shape) continue;

        let body;
        if (needsPoseProxy(leaf)) {
            const proxy = new THREE.Object3D();
            applyLocalOffsetToProxy(anchor, proxy, leaf.offset, leaf.rotation);
            body = createStaticBody(physicsWorld, proxy, shape);
            proxy.userData.physicsBody = null;
        } else {
            body = createStaticBody(physicsWorld, anchor, shape);
        }

        if (!body) continue;

        attachBodyToAnchor(anchor, body);
        if (!first) first = { body, shapes: [shape] };
    }

    return first;
}

export function destroyStaticCollider(physicsWorld, body) {
    destroyPhysicsBody(physicsWorld, body);
}

export function destroyWasmStaticCollider(wasmId) {
    wasmRemoveStaticCollider(wasmId);
}
