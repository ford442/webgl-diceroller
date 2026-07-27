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
import { createStaticCollider } from '../core/StaticColliderBridge.js';

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

/**
 * Standard prop factory scaffold: group setup, build callback, colliders, scene add.
 */
export function createProp(
    scene,
    physicsWorld,
    {
        name,
        position = { x: 0, y: 0, z: 0 },
        rotation = 0,
        footOffsetY = 0,
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
    group.position.set(position.x, position.y + footOffsetY, position.z);
    group.rotation.y = rotation;

    build?.({ group, materials, mesh });

    scene.add(group);

    let body = null;
    if (physicsWorld && colliders.length > 0) {
        for (const colliderSpec of colliders) {
            const result = createStaticCollider(physicsWorld, group, colliderSpec);
            if (!body && result?.body) body = result.body;
        }
    }

    const propResult = { group, ...extras };
    if (body) propResult.body = body;
    if (update) propResult.update = update;
    if (interact) propResult.interact = interact;
    if (dispose) propResult.dispose = dispose;
    return propResult;
}
