import * as THREE from 'three';
import {
    getBlackAccentMaterial,
    getBookCoverMaterial,
    getBookCoverMaterials,
    getBrassMaterial,
    getCeramicInnerMaterial,
    getCeramicMaterial,
    getClothMaterial,
    getCopperMaterial,
    getDarkLeatherMaterial,
    getDarkRedMaterial,
    getGoldMaterial,
    getInstancedMetalMaterial,
    getIronMaterial,
    getLeatherMaterial,
    getPaperMaterial,
    getParchmentMaterial,
    getPewterMaterial,
    getRustedIronMaterial,
    getSilverMaterial,
    getSteelMaterial,
    getWaxMaterial,
    getWickMaterial,
    getWoodMaterial,
    getWoodTexturedMaterial,
    getWroughtIronMaterial,
} from '../core/MaterialPalette.js';
import { createStaticCollider, createDynamicCollider } from '../core/StaticColliderBridge.js';
export { STATIC_MATERIAL } from '../wasm/staticColliders.js';

export const materials = {
    wood: (color) => getWoodMaterial(color),
    woodTextured: () => getWoodTexturedMaterial(),
    iron: () => getIronMaterial(),
    rustedIron: () => getRustedIronMaterial(),
    wroughtIron: () => getWroughtIronMaterial(),
    steel: () => getSteelMaterial(),
    gold: () => getGoldMaterial(),
    brass: () => getBrassMaterial(),
    silver: () => getSilverMaterial(),
    copper: () => getCopperMaterial(),
    pewter: () => getPewterMaterial(),
    instancedMetal: () => getInstancedMetalMaterial(),
    leather: () => getLeatherMaterial(),
    darkLeather: () => getDarkLeatherMaterial(),
    ceramic: () => getCeramicMaterial(),
    ceramicInner: () => getCeramicInnerMaterial(),
    wax: () => getWaxMaterial(),
    parchment: () => getParchmentMaterial(),
    paper: () => getPaperMaterial(),
    cloth: (color) => getClothMaterial(color),
    darkRed: () => getDarkRedMaterial(),
    blackAccent: () => getBlackAccentMaterial(),
    wick: () => getWickMaterial(),
    bookCover: (index) => getBookCoverMaterial(index),
    bookCovers: () => getBookCoverMaterials(),
};

function applyVector3(target, value) {
    if (Array.isArray(value)) {
        target.set(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
        return;
    }
    target.set(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

function applyEuler(target, value) {
    if (Array.isArray(value)) {
        target.set(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
        return;
    }
    target.set(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

/**
 * Create a mesh with default shadow flags for environment props.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Material} material
 * @param {{
 *   castShadow?: boolean,
 *   receiveShadow?: boolean,
 *   position?: { x?: number, y?: number, z?: number } | number[],
 *   rotation?: { x?: number, y?: number, z?: number } | number[],
 *   name?: string,
 * }} [options]
 */
export function mesh(
    geometry,
    material,
    { castShadow = true, receiveShadow = true, position, rotation, name } = {}
) {
    const result = new THREE.Mesh(geometry, material);
    result.castShadow = castShadow;
    result.receiveShadow = receiveShadow;
    if (position) applyVector3(result.position, position);
    if (rotation) applyEuler(result.rotation, rotation);
    if (name) result.name = name;
    return result;
}

function scaleVec3Spec(value, factor) {
    if (!value) return value;
    if (Array.isArray(value)) return value.map((component) => (component ?? 0) * factor);
    return {
        x: (value.x ?? 0) * factor,
        y: (value.y ?? 0) * factor,
        z: (value.z ?? 0) * factor,
    };
}

/**
 * Scale a declarative collider spec's lengths by `factor`.
 *
 * Colliders are authored in prop-local units, but `StaticColliderBridge` builds
 * shapes straight from the spec and anchors them to the group's position and
 * quaternion — `group.scale` is ignored. So a scaled prop has to hand the bridge
 * pre-scaled dimensions or its collider drifts from its mesh. Rotations are
 * scale-invariant; mass follows volume (factor^3).
 *
 * @param {any} spec
 * @param {number} factor
 * @returns {any}
 */
export function scaleColliderSpec(spec, factor) {
    if (!spec || factor === 1) return spec;

    /** @type {any} */
    const scaled = { ...spec };
    if (Array.isArray(spec.halfExtents)) {
        scaled.halfExtents = spec.halfExtents.map((extent) => extent * factor);
    }
    if (typeof spec.radius === 'number') scaled.radius = spec.radius * factor;
    if (typeof spec.halfHeight === 'number') scaled.halfHeight = spec.halfHeight * factor;
    if (typeof spec.height === 'number') scaled.height = spec.height * factor;
    if (typeof spec.dist === 'number') scaled.dist = spec.dist * factor;
    if (typeof spec.mass === 'number') scaled.mass = spec.mass * factor ** 3;
    if (spec.offset) scaled.offset = scaleVec3Spec(spec.offset, factor);
    if (Array.isArray(spec.vertices)) {
        scaled.vertices = spec.vertices.map((vertex) =>
            [vertex[0] ?? 0, vertex[1] ?? 0, vertex[2] ?? 0].map((c) => c * factor)
        );
    }
    if (Array.isArray(spec.parts)) {
        scaled.parts = spec.parts.map((part) => scaleColliderSpec(part, factor));
    }
    return scaled;
}

/**
 * Standard prop factory scaffold: group setup, build callback, colliders, scene add.
 * @param {THREE.Scene} scene
 * @param {import('../wasm/physicsTypes').PhysicsEngine | null | undefined} physicsWorld
 * @param {{
 *   name?: string,
 *   position?: { x?: number, y?: number, z?: number },
 *   rotation?: number,
 *   footOffsetY?: number,
 *   scale?: number,
 *   build?: (ctx: { group: THREE.Group, materials: typeof materials, mesh: typeof mesh }) => void,
 *   colliders?: object[],
 *   update?: (...args: any[]) => void,
 *   interact?: (...args: any[]) => void,
 *   dispose?: (...args: any[]) => void,
 *   [extra: string]: any,
 * }} [options]
 */
export function createProp(
    scene,
    physicsWorld,
    {
        name,
        position = { x: 0, y: 0, z: 0 },
        rotation = 0,
        footOffsetY = 0,
        scale = 1,
        build,
        colliders = [],
        update,
        interact,
        dispose,
        ...extras
    } = {}
) {
    const group = new THREE.Group();
    group.name = name;
    // footOffsetY lifts the group by a prop-local distance, so it scales too.
    group.position.set(position.x, position.y + footOffsetY * scale, position.z);
    group.rotation.y = rotation;
    if (scale !== 1) group.scale.setScalar(scale);

    build?.({ group, materials, mesh });

    scene.add(group);

    let body = null;
    if (colliders.length > 0) {
        for (const authoredSpec of colliders) {
            const colliderSpec = scaleColliderSpec(authoredSpec, scale);
            const result = colliderSpec.dynamic
                ? createDynamicCollider(physicsWorld, group, colliderSpec)
                : createStaticCollider(physicsWorld, group, colliderSpec);
            if (!body && result?.body) body = result.body;
        }
    }

    /** @type {{ group: THREE.Group, body?: unknown, update?: (...args: any[]) => void, interact?: (...args: any[]) => void, dispose?: (...args: any[]) => void, [extra: string]: any }} */
    const propResult = { group, ...extras };
    if (body) propResult.body = body;
    if (update) propResult.update = update;
    if (interact) propResult.interact = interact;
    if (dispose) propResult.dispose = dispose;
    return propResult;
}
