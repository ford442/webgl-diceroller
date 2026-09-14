import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isPaletteMaterial } from './MaterialPalette.js';

const _matrix = new THREE.Matrix4();
const _rootInverse = new THREE.Matrix4();

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
 * `mergeGeometries()` requires every input to agree on both index presence and
 * attribute set; when they disagree it logs
 * "All geometries must have compatible attributes" and returns null. Whether
 * that happens here depends on which props the clutter seed spawned into the
 * same material group, so it showed up as an intermittent console error across
 * the whole browser suite (and silently lost the batching).
 *
 * Normalise the group instead: drop to the attributes every geometry has, and
 * de-index everything if the group is mixed. Dropping an attribute only
 * affects the merged copy, and any attribute missing from one member could not
 * have survived the merge anyway.
 *
 * @param {import('three').BufferGeometry[]} geometries
 * @returns {import('three').BufferGeometry[]}
 */
function normalizeForMerge(geometries) {
    const shared = geometries.reduce((acc, geo) => {
        const names = new Set(Object.keys(geo.attributes));
        return acc === null ? names : new Set([...acc].filter((n) => names.has(n)));
    }, /** @type {Set<string> | null} */ (null));

    const mixedIndex = geometries.some((g) => Boolean(g.index) !== Boolean(geometries[0].index));

    return geometries.map((geo) => {
        let out = geo;
        for (const name of Object.keys(out.attributes)) {
            if (!shared?.has(name)) {
                if (out === geo) out = geo.clone();
                out.deleteAttribute(name);
            }
        }
        if (mixedIndex && out.index) {
            const deindexed = out.toNonIndexed();
            if (out !== geo) out.dispose();
            out = deindexed;
        }
        return out;
    });
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

    // The merged group is re-parented under `root`, so bake each leaf's pose
    // *relative to the root* — baking matrixWorld here would apply the root's
    // own transform a second time at render, offsetting merged geometry from
    // the collider that stays anchored to the root.
    _rootInverse.copy(root.matrixWorld).invert();

    for (const mesh of candidates) {
        mesh.updateWorldMatrix(true, false);
        const geo = mesh.geometry.clone();
        _matrix.multiplyMatrices(_rootInverse, mesh.matrixWorld);
        geo.applyMatrix4(_matrix);

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

        const normalized = normalizeForMerge(geometries);
        const mergedGeo = mergeGeometries(normalized, false);
        normalized.forEach((g, i) => {
            if (g !== geometries[i]) g.dispose();
        });
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
