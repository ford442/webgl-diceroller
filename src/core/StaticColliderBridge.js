import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';
import { destroyPhysicsBody } from '../environment/PropLifecycle.js';
import {
    addStaticCollider as wasmAddStaticCollider,
    isWasmAvailable,
    removeStaticCollider as wasmRemoveStaticCollider,
} from '../wasm/PhysicsBridge.js';

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

function buildAmmoShape(ammo, spec) {
    switch (spec.type) {
        case 'box': {
            const [hx, hy, hz] = spec.halfExtents;
            const halfExtents = new ammo.btVector3(hx, hy, hz);
            const shape = new ammo.btBoxShape(halfExtents);
            ammo.destroy(halfExtents);
            return shape;
        }
        case 'cylinder': {
            const halfExtents = new ammo.btVector3(spec.radius, spec.halfHeight, spec.radius);
            const shape = new ammo.btCylinderShape(halfExtents);
            ammo.destroy(halfExtents);
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

    if (getStaticColliderBackend() === 'wasm') {
        const wasmId = wasmAddStaticCollider(spec, anchor);
        if (wasmId < 0) return null;
        attachWasmIdToAnchor(anchor, wasmId);
        return { wasmId };
    }

    if (!physicsWorld) return null;

    const ammo = getAmmo();
    if (!ammo) return null;

    const shape = buildAmmoShape(ammo, spec);
    if (!shape) return null;

    let body;
    if (needsPoseProxy(spec)) {
        const proxy = new THREE.Object3D();
        applyLocalOffsetToProxy(anchor, proxy, spec.offset, spec.rotation);
        body = createStaticBody(physicsWorld, proxy, shape);
        proxy.userData.physicsBody = null;
    } else {
        body = createStaticBody(physicsWorld, anchor, shape);
    }

    if (!body) return null;

    attachBodyToAnchor(anchor, body);
    return { body, shapes: [shape] };
}

export function destroyStaticCollider(physicsWorld, body) {
    destroyPhysicsBody(physicsWorld, body);
}

export function destroyWasmStaticCollider(wasmId) {
    wasmRemoveStaticCollider(wasmId);
}
