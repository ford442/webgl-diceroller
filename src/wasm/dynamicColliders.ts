import * as THREE from 'three';
import type { PhysicsEngine } from './physicsTypes.js';
import type { StaticColliderSpec } from '../types/staticCollider.js';
import { computeWorldPose } from './staticColliders.js';

let nextAutoDynamicId = 20000;

export function allocDynamicColliderId(): number {
    return nextAutoDynamicId++;
}

export function resetDynamicColliderIds(seed = 20000): void {
    nextAutoDynamicId = seed;
}

/**
 * Build a convex prism (N-gon) approximating a Y-aligned cylinder, in local
 * space — flat [x,y,z, x,y,z, ...] vertices for `addDynamicHull`. The dynamic
 * engine API only knows box/hull shapes (no true cylinder), so any collider
 * spec declared as 'cylinder'/'openCylinder' with `dynamic: true` goes through
 * this synthesis rather than `addStaticOpenCylinder`'s radial-plane approach.
 */
function cylinderPrismVerts(radius: number, halfHeight: number, segments = 12): number[] {
    const flat: number[] = [];
    for (const y of [-halfHeight, halfHeight]) {
        for (let i = 0; i < segments; i++) {
            const angle = (Math.PI * 2 * i) / segments;
            flat.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        }
    }
    return flat;
}

/**
 * Register a collider spec with `dynamic: true` as a dynamic (movable) body.
 * Mirrors `addStaticColliderToEngine` in staticColliders.ts, but only box,
 * cylinder/openCylinder (synthesized into a hull), and convexHull shapes are
 * supported — 'plane' has no dynamic equivalent.
 */
export function addDynamicColliderToEngine(
    engine: PhysicsEngine,
    spec: StaticColliderSpec & { dynamic?: boolean; mass?: number },
    worldPose: { position: THREE.Vector3; quaternion: THREE.Quaternion }
): number {
    const id = spec.id ?? allocDynamicColliderId();
    const materialTag = spec.materialTag ?? 0;
    const mass = spec.mass;
    if (!mass || mass <= 0) {
        console.warn(`dynamicColliders: dynamic collider requires mass > 0 (type "${spec.type}")`);
        return -1;
    }
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
            return engine.addDynamicBox(
                id,
                mass,
                px,
                py,
                pz,
                hx,
                hy,
                hz,
                qx,
                qy,
                qz,
                qw,
                materialTag
            );
        }
        case 'cylinder':
        case 'openCylinder': {
            const halfHeight = spec.halfHeight ?? (spec.height != null ? spec.height / 2 : 0);
            const flat = cylinderPrismVerts(spec.radius, halfHeight, spec.segments ?? 12);
            return engine.addDynamicHull(id, mass, px, py, pz, qx, qy, qz, qw, flat, materialTag);
        }
        case 'convexHull': {
            const flat = spec.vertices.flat();
            return engine.addDynamicHull(id, mass, px, py, pz, qx, qy, qz, qw, flat, materialTag);
        }
        default: {
            console.warn(`dynamicColliders: unsupported dynamic type "${spec.type}"`);
            return -1;
        }
    }
}

export function addDynamicColliderForEngine(
    engine: PhysicsEngine | null | undefined,
    spec: StaticColliderSpec & { dynamic?: boolean; mass?: number },
    anchor: THREE.Object3D
): number {
    if (!engine) return -1;
    const worldPose = computeWorldPose(anchor, spec);
    return addDynamicColliderToEngine(engine, spec, worldPose);
}

export function removeDynamicColliderForEngine(
    engine: PhysicsEngine | null | undefined,
    userId: number
): boolean {
    return !!engine?.removeDynamic?.(userId);
}
