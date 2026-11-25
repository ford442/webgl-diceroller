import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bakeDieGeometry } from '../../src/dice/DiceGeometryGroups.js';

/** An octahedron like the shipped d8: quantized to normalized int16, then given the
 *  kind of node transform the GLBs carry (uniform scale + a translation > 1). */
function quantizedHull(): THREE.BufferGeometry {
    const verts = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0.7, 0, 0, -0.7];
    const ints = Int16Array.from(verts.map((v) => Math.round(v * 32767)));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ints, 3, true));
    return g;
}

const nodeMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0.01, 0.05, 1.17),
    new THREE.Quaternion(),
    new THREE.Vector3(0.673, 0.673, 0.673)
);

function size(g: THREE.BufferGeometry): number[] {
    g.computeBoundingBox();
    return g.boundingBox!.max.clone().sub(g.boundingBox!.min).toArray();
}

describe('bakeDieGeometry', () => {
    it('keeps the hull intact when the node translation pushes it past the int16 range', () => {
        const baked = bakeDieGeometry(quantizedHull(), nodeMatrix);
        // x, y(file z), z(file y) after the Y-up rotation, node scale applied
        const [sx, sy, sz] = size(baked);
        expect(sx).toBeCloseTo(2 * 0.673, 2);
        expect(sy).toBeCloseTo(1.4 * 0.673, 2);
        expect(sz).toBeCloseTo(2 * 0.673, 2);
    });

    it('returns float32 positions centred on the origin', () => {
        const baked = bakeDieGeometry(quantizedHull(), nodeMatrix);
        expect(baked.getAttribute('position').array).toBeInstanceOf(Float32Array);
        baked.computeBoundingBox();
        const c = baked.boundingBox!.getCenter(new THREE.Vector3());
        expect(c.length()).toBeLessThan(1e-4);
    });

    it('does not modify the source geometry', () => {
        const src = quantizedHull();
        const before = Array.from(src.getAttribute('position').array);
        bakeDieGeometry(src, nodeMatrix);
        expect(Array.from(src.getAttribute('position').array)).toEqual(before);
        expect(src.getAttribute('position').array).toBeInstanceOf(Int16Array);
    });
});
