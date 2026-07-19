import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isPaletteMaterial } from './MaterialPalette.js';

const _matrix = new THREE.Matrix4();

/**
 * Leaf meshes eligible for static batching inside a prop root.
 * Skips instanced draws, lights, and meshes flagged for raycast targets.
 */
export function isMergeableMesh(obj) {
    if (!obj?.isMesh || obj.isInstancedMesh) return false;
    if (obj.userData?.mergeable === false || obj.userData?.raycastTarget) return false;
    if (obj.userData?.mergedStatic) return false;
    return true;
}

function materialKey(material) {
    if (Array.isArray(material)) return material.map((m) => m?.uuid ?? 'null').join('|');
    return material?.uuid ?? 'null';
}

function disposeMeshGeometry(mesh) {
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) {
        material.forEach((mat) => {
            if (!isPaletteMaterial(mat)) mat?.dispose?.();
        });
    } else if (!isPaletteMaterial(material)) {
        material?.dispose?.();
    }
}

/**
 * Merge static leaf meshes inside a single prop root, grouped by material.
 * Physics bodies on the root are untouched; only visual leaf meshes collapse.
 *
 * @returns {{ merged: boolean, drawCallsSaved: number, mergedMeshes: number }}
 */
export function mergeStaticMeshesInRoot(root, { name = 'merged-static' } = {}) {
    if (!root?.isObject3D) return { merged: false, drawCallsSaved: 0, mergedMeshes: 0 };

    const byMaterial = new Map();
    const candidates = [];

    root.updateWorldMatrix(true, true);

    root.traverse((obj) => {
        if (!isMergeableMesh(obj)) return;
        // Only merge leaf meshes (no child meshes beneath).
        for (const child of obj.children) {
            if (child.isMesh) return;
        }
        candidates.push(obj);
    });

    if (candidates.length < 2) {
        return { merged: false, drawCallsSaved: 0, mergedMeshes: 0 };
    }

    for (const mesh of candidates) {
        mesh.updateWorldMatrix(true, false);
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);

        const key = materialKey(mesh.material);
        if (!byMaterial.has(key)) {
            byMaterial.set(key, { material: mesh.material, geometries: [] });
        }
        byMaterial.get(key).geometries.push(geo);
    }

    let drawCallsSaved = 0;
    let mergedMeshes = 0;
    const mergedGroup = new THREE.Group();
    mergedGroup.name = name;

    for (const { material, geometries } of byMaterial.values()) {
        if (geometries.length < 2) {
            geometries.forEach((g) => g.dispose());
            continue;
        }

        const mergedGeo = mergeGeometries(geometries, false);
        geometries.forEach((g) => g.dispose());
        if (!mergedGeo) continue;

        const mergedMesh = new THREE.Mesh(mergedGeo, material);
        mergedMesh.castShadow = true;
        mergedMesh.receiveShadow = true;
        mergedMesh.userData.mergedStatic = true;
        mergedGroup.add(mergedMesh);
        drawCallsSaved += geometries.length - 1;
        mergedMeshes++;
    }

    if (mergedMeshes === 0) {
        return { merged: false, drawCallsSaved: 0, mergedMeshes: 0 };
    }

    for (const mesh of candidates) {
        mesh.parent?.remove(mesh);
        disposeMeshGeometry(mesh);
    }

    root.add(mergedGroup);
    return { merged: true, drawCallsSaved, mergedMeshes };
}

function rootHasLight(root) {
    let found = false;
    root.traverse((child) => {
        if (child.isLight) found = true;
    });
    return found;
}

/**
 * Intra-prop merge pass for clutter / decor scatter handles.
 * Skips animated roots (lights, instanced props already batched).
 */
export function mergeScatterHandles(handles) {
    let drawCallsSaved = 0;
    let mergedRoots = 0;

    for (const root of handles) {
        if (!root?.isObject3D) continue;
        if (root.isInstancedMesh) continue;
        if (rootHasLight(root)) continue;

        const result = mergeStaticMeshesInRoot(root, { name: `${root.name || 'scatter'}-merged` });
        if (result.merged) {
            mergedRoots++;
            drawCallsSaved += result.drawCallsSaved;
        }
    }

    return { mergedRoots, drawCallsSaved };
}

/**
 * Merge static decor props spawned from tier entries (no per-frame update).
 */
export function mergePropRecord(record) {
    const root = record?.result?.group ?? (record?.result?.isObject3D ? record.result : null);
    if (!root?.isObject3D) return { merged: false, drawCallsSaved: 0 };
    if (record.updateHandle) return { merged: false, drawCallsSaved: 0 };
    if (rootHasLight(root)) return { merged: false, drawCallsSaved: 0 };

    return mergeStaticMeshesInRoot(root, { name: `${root.name || 'prop'}-merged` });
}
