import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeScatterHandles, mergeStaticMeshesInRoot } from '../../src/core/StaticPropMerger.js';

/**
 * Build a prop-shaped root: a transformed group holding leaf meshes that share
 * one material (the shape `createProp` produces for every clutter/decor prop).
 */
function buildPropRoot({ position, rotationY = 0, scale = 1 }) {
    const root = new THREE.Group();
    root.name = 'TestProp';
    root.position.copy(position);
    root.rotation.y = rotationY;
    root.scale.setScalar(scale);

    const material = new THREE.MeshBasicMaterial();
    for (const y of [0, 1]) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
        leaf.position.y = y;
        root.add(leaf);
    }

    const scene = new THREE.Scene();
    scene.add(root);
    return { root, scene };
}

function mergedWorldCenter(root, scene) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    root.traverse((obj) => {
        if (!obj.isMesh || !obj.userData.mergedStatic) return;
        obj.geometry.computeBoundingBox();
        box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
    });
    return box.getCenter(new THREE.Vector3());
}

describe('mergeStaticMeshesInRoot', () => {
    it('merges a group whose geometries disagree on index and attributes', () => {
        // Whether two props with mismatched geometry land in the same material
        // group depends on the clutter seed, so this surfaced in CI as an
        // intermittent "All geometries must have compatible attributes" console
        // error that failed unrelated browser smoke tests — and silently lost
        // the batching when it happened.
        const root = new THREE.Group();
        const material = new THREE.MeshBasicMaterial();

        const indexedWithUv = new THREE.BoxGeometry(1, 1, 1);
        expect(indexedWithUv.index).not.toBeNull();
        expect(indexedWithUv.attributes.uv).toBeDefined();

        // Non-indexed, and carrying no uv — the two ways three.js rejects a merge.
        const nonIndexedNoUv = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
        nonIndexedNoUv.deleteAttribute('uv');

        for (const geo of [indexedWithUv, nonIndexedNoUv]) {
            root.add(new THREE.Mesh(geo, material));
        }

        const errors = [];
        const consoleError = console.error;
        console.error = (...args) => errors.push(args.join(' '));
        let result;
        try {
            result = mergeStaticMeshesInRoot(root);
        } finally {
            console.error = consoleError;
        }

        expect(errors).toEqual([]);
        expect(result.merged).toBe(true);
        expect(result.mergedMeshes).toBe(1);

        /** @type {THREE.Mesh[]} */
        const merged = [];
        root.traverse((o) => {
            if (/** @type {THREE.Mesh} */ (o).isMesh && o.userData.mergedStatic) {
                merged.push(/** @type {THREE.Mesh} */ (o));
            }
        });
        expect(merged).toHaveLength(1);
        // Both boxes survive: 12 triangles each, de-indexed to 36 verts apiece.
        expect(merged[0].geometry.attributes.position.count).toBe(72);
        // uv is dropped, because only one of the two inputs had it.
        expect(merged[0].geometry.attributes.uv).toBeUndefined();
    });

    it('keeps merged geometry at the pre-merge world position', () => {
        const position = new THREE.Vector3(5, 1, -3);
        const { root, scene } = buildPropRoot({ position });

        // Leaves at local y=0 and y=1 → local center y=0.5, world y = 1 + 0.5.
        const expected = new THREE.Vector3(5, 1.5, -3);

        const result = mergeStaticMeshesInRoot(root);
        expect(result.merged).toBe(true);

        const center = mergedWorldCenter(root, scene);
        expect(center.x).toBeCloseTo(expected.x, 5);
        expect(center.y).toBeCloseTo(expected.y, 5);
        expect(center.z).toBeCloseTo(expected.z, 5);
    });

    it('respects root rotation and scale', () => {
        const position = new THREE.Vector3(-4, 2, 7);
        const { root, scene } = buildPropRoot({
            position,
            rotationY: Math.PI / 3,
            scale: 0.5,
        });

        // Local center (0, 0.5, 0) is on the rotation axis, so only scale applies.
        const expected = new THREE.Vector3(-4, 2 + 0.5 * 0.5, 7);

        expect(mergeStaticMeshesInRoot(root).merged).toBe(true);

        const center = mergedWorldCenter(root, scene);
        expect(center.x).toBeCloseTo(expected.x, 5);
        expect(center.y).toBeCloseTo(expected.y, 5);
        expect(center.z).toBeCloseTo(expected.z, 5);
    });

    it('leaves the root transform untouched so colliders stay anchored', () => {
        const position = new THREE.Vector3(9, -1, 2);
        const { root } = buildPropRoot({ position });

        mergeStaticMeshesInRoot(root);

        expect(root.position.x).toBeCloseTo(position.x, 5);
        expect(root.position.y).toBeCloseTo(position.y, 5);
        expect(root.position.z).toBeCloseTo(position.z, 5);
        expect(root.scale.x).toBeCloseTo(1, 5);
    });
});

describe('mergeScatterHandles', () => {
    it('merges positioned clutter roots in place', () => {
        const position = new THREE.Vector3(12, 1, -6);
        const { root, scene } = buildPropRoot({ position });

        const stats = mergeScatterHandles([root]);
        expect(stats.mergedRoots).toBe(1);
        expect(stats.drawCallsSaved).toBe(1);

        const center = mergedWorldCenter(root, scene);
        expect(center.x).toBeCloseTo(12, 5);
        expect(center.y).toBeCloseTo(1.5, 5);
        expect(center.z).toBeCloseTo(-6, 5);
    });

    it('skips roots that carry a light', () => {
        const { root } = buildPropRoot({ position: new THREE.Vector3(1, 0, 1) });
        root.add(new THREE.PointLight(0xffffff, 1, 5));

        expect(mergeScatterHandles([root]).mergedRoots).toBe(0);
    });
});
