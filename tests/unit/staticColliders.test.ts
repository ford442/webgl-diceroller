/**
 * Coverage for the declarative-collider-spec -> WASM-engine translation layer.
 * The engine is a pure vi.fn() mock; only the translation logic is exercised.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    STATIC_MATERIAL,
    addStaticColliderForEngine,
    addStaticColliderToEngine,
    allocStaticColliderId,
    clearStaticCollidersForEngine,
    computeWorldPose,
    createWasmTableBoundsForEngine,
    removeStaticColliderForEngine,
    resetStaticColliderIds,
} from '../../src/wasm/staticColliders.js';

function makeMockEngine() {
    return {
        addStaticBox: vi.fn(() => 1),
        addStaticPlane: vi.fn(() => 2),
        addStaticOpenCylinder: vi.fn(() => 3),
        addStaticConvexHull: vi.fn(() => 4),
        clearStatics: vi.fn(),
        removeStatic: vi.fn(() => true),
        getStaticCapacityDroppedCount: vi.fn(() => 0),
    };
}

describe('allocStaticColliderId / resetStaticColliderIds', () => {
    afterEach(() => {
        resetStaticColliderIds();
    });

    it('increments ids from a starting point', () => {
        resetStaticColliderIds(500);
        const a = allocStaticColliderId();
        const b = allocStaticColliderId();
        expect(a).toBe(500);
        expect(b).toBe(501);
    });

    it('reset changes the next-issued id', () => {
        resetStaticColliderIds(9);
        expect(allocStaticColliderId()).toBe(9);
        resetStaticColliderIds(100);
        expect(allocStaticColliderId()).toBe(100);
    });
});

describe('computeWorldPose', () => {
    it('is a no-op for an anchor at the origin with no offset/rotation', () => {
        const anchor = new THREE.Object3D();
        const { position, quaternion } = computeWorldPose(anchor, {});
        expect(position.x).toBe(0);
        expect(position.y).toBe(0);
        expect(position.z).toBe(0);
        expect(quaternion.x).toBe(0);
        expect(quaternion.y).toBe(0);
        expect(quaternion.z).toBe(0);
        expect(quaternion.w).toBe(1);
    });

    it('applies a local offset object form directly when the anchor has no rotation', () => {
        const anchor = new THREE.Object3D();
        anchor.position.set(1, 2, 3);
        anchor.updateMatrixWorld(true);
        const { position } = computeWorldPose(anchor, { offset: { x: 1, y: 0, z: 0 } });
        expect(position.x).toBe(2);
        expect(position.y).toBe(2);
        expect(position.z).toBe(3);
    });

    it('applies a local offset array form directly when the anchor has no rotation', () => {
        const anchor = new THREE.Object3D();
        anchor.position.set(1, 2, 3);
        anchor.updateMatrixWorld(true);
        const { position } = computeWorldPose(anchor, { offset: [1, 0, 0] });
        expect(position.x).toBe(2);
        expect(position.y).toBe(2);
        expect(position.z).toBe(3);
    });

    it('rotates the local offset into world space for a rotated+translated anchor', () => {
        const anchor = new THREE.Object3D();
        anchor.position.set(5, 0, 0);
        anchor.rotation.set(0, Math.PI / 2, 0); // 90deg about Y
        anchor.updateMatrixWorld(true);

        const { position } = computeWorldPose(anchor, { offset: { x: 1, y: 0, z: 0 } });
        // Rotating +X by 90deg about Y maps to -Z (THREE's right-handed convention).
        expect(position.x).toBeCloseTo(5, 5);
        expect(position.y).toBeCloseTo(0, 5);
        expect(position.z).toBeCloseTo(-1, 5);
    });

    it('combines anchor rotation with a local spec rotation (array form)', () => {
        const anchor = new THREE.Object3D();
        anchor.rotation.set(0, Math.PI / 2, 0);
        anchor.updateMatrixWorld(true);

        const { quaternion } = computeWorldPose(anchor, { rotation: [0, Math.PI / 2, 0] });
        const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
        expect(quaternion.x).toBeCloseTo(expected.x, 5);
        expect(quaternion.y).toBeCloseTo(expected.y, 5);
        expect(quaternion.z).toBeCloseTo(expected.z, 5);
        expect(quaternion.w).toBeCloseTo(expected.w, 5);
    });
});

describe('addStaticColliderToEngine', () => {
    const worldPose = {
        position: new THREE.Vector3(1, 2, 3),
        quaternion: new THREE.Quaternion(0.1, 0.2, 0.3, 0.9),
    };

    it('calls addStaticBox with halfExtents for a box spec', () => {
        const engine = makeMockEngine();
        const spec = {
            type: 'box' as const,
            id: 42,
            halfExtents: [0.5, 0.25, 0.125] as [number, number, number],
        };
        const result = addStaticColliderToEngine(engine as any, spec, worldPose);
        expect(result).toBe(1);
        expect(engine.addStaticBox).toHaveBeenCalledWith(
            42,
            1,
            2,
            3,
            0.5,
            0.25,
            0.125,
            worldPose.quaternion.x,
            worldPose.quaternion.y,
            worldPose.quaternion.z,
            worldPose.quaternion.w,
            STATIC_MATERIAL.DEFAULT
        );
    });

    it('calls addStaticPlane with normal + dist for a plane spec', () => {
        const engine = makeMockEngine();
        const spec = {
            type: 'plane' as const,
            id: 7,
            normal: { x: 0, y: 1, z: 0 },
            dist: 4.5,
        };
        const result = addStaticColliderToEngine(engine as any, spec, worldPose);
        expect(result).toBe(2);
        expect(engine.addStaticPlane).toHaveBeenCalledWith(
            7,
            0,
            1,
            0,
            4.5,
            STATIC_MATERIAL.DEFAULT
        );
    });

    it('calls addStaticOpenCylinder using halfHeight when given', () => {
        const engine = makeMockEngine();
        const spec = {
            type: 'cylinder' as const,
            id: 8,
            radius: 2,
            halfHeight: 1.5,
            segments: 24,
            closedBottom: true,
        };
        const result = addStaticColliderToEngine(engine as any, spec, worldPose);
        expect(result).toBe(3);
        expect(engine.addStaticOpenCylinder).toHaveBeenCalledWith(
            8,
            1,
            2,
            3,
            2,
            1.5,
            24,
            true,
            STATIC_MATERIAL.DEFAULT
        );
    });

    it('calls addStaticOpenCylinder deriving halfHeight from height/2 for openCylinder', () => {
        const engine = makeMockEngine();
        const spec = {
            type: 'openCylinder' as const,
            id: 9,
            radius: 3,
            height: 5,
        };
        addStaticColliderToEngine(engine as any, spec, worldPose);
        expect(engine.addStaticOpenCylinder).toHaveBeenCalledWith(
            9,
            1,
            2,
            3,
            3,
            2.5,
            16, // default segments
            false, // default closedBottom
            STATIC_MATERIAL.DEFAULT
        );
    });

    it('calls addStaticConvexHull with flattened vertices', () => {
        const engine = makeMockEngine();
        const spec = {
            type: 'convexHull' as const,
            id: 11,
            vertices: [
                [0, 0, 0],
                [1, 0, 0],
                [0, 1, 0],
            ],
        };
        const result = addStaticColliderToEngine(engine as any, spec, worldPose);
        expect(result).toBe(4);
        expect(engine.addStaticConvexHull).toHaveBeenCalledWith(
            11,
            1,
            2,
            3,
            worldPose.quaternion.x,
            worldPose.quaternion.y,
            worldPose.quaternion.z,
            worldPose.quaternion.w,
            [0, 0, 0, 1, 0, 0, 0, 1, 0],
            STATIC_MATERIAL.DEFAULT
        );
    });

    it('returns -1 and calls no engine method for an unsupported type', () => {
        const engine = makeMockEngine();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const spec = { type: 'sphere' } as any;
        const result = addStaticColliderToEngine(engine as any, spec, worldPose);
        expect(result).toBe(-1);
        expect(engine.addStaticBox).not.toHaveBeenCalled();
        expect(engine.addStaticPlane).not.toHaveBeenCalled();
        expect(engine.addStaticOpenCylinder).not.toHaveBeenCalled();
        expect(engine.addStaticConvexHull).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('defaults materialTag to STATIC_MATERIAL.DEFAULT when omitted', () => {
        const engine = makeMockEngine();
        const spec = { type: 'plane' as const, normal: { x: 0, y: 1, z: 0 }, dist: 0 };
        addStaticColliderToEngine(engine as any, spec, worldPose);
        const args = engine.addStaticPlane.mock.calls[0];
        expect(args[args.length - 1]).toBe(STATIC_MATERIAL.DEFAULT);
    });

    it('passes materialTag through when provided', () => {
        const engine = makeMockEngine();
        const spec = {
            type: 'plane' as const,
            normal: { x: 0, y: 1, z: 0 },
            dist: 0,
            materialTag: STATIC_MATERIAL.METAL,
        };
        addStaticColliderToEngine(engine as any, spec, worldPose);
        const args = engine.addStaticPlane.mock.calls[0];
        expect(args[args.length - 1]).toBe(STATIC_MATERIAL.METAL);
    });
});

describe('createWasmTableBoundsForEngine', () => {
    beforeEach(() => {
        resetStaticColliderIds();
    });

    it('returns 0 immediately when engine lacks addStaticBox or clearStatics', () => {
        expect(createWasmTableBoundsForEngine({} as any, { physicsBodies: [] })).toBe(0);
        expect(
            createWasmTableBoundsForEngine({ addStaticBox: vi.fn() } as any, { physicsBodies: [] })
        ).toBe(0);
        expect(
            createWasmTableBoundsForEngine({ clearStatics: vi.fn() } as any, { physicsBodies: [] })
        ).toBe(0);
    });

    it('calls clearStatics, adds only box bodies, computes material tags, and counts successes', () => {
        const engine = makeMockEngine();
        engine.addStaticBox
            .mockReturnValueOnce(1) // velvet body (low restitution)
            .mockReturnValueOnce(-1) // wood body, rejected -> not counted
            .mockReturnValueOnce(2); // explicit materialTag body

        const tableConfig = {
            physicsBodies: [
                {
                    type: 'box',
                    position: { x: 0, y: 0, z: 0 },
                    size: { x: 2, y: 2, z: 2 },
                    restitution: 0.05, // <= 0.1 -> VELVET
                },
                {
                    type: 'box',
                    position: { x: 1, y: 1, z: 1 },
                    size: { x: 4, y: 4, z: 4 },
                    restitution: 0.5, // -> WOOD
                },
                {
                    type: 'box',
                    position: { x: 2, y: 2, z: 2 },
                    size: { x: 6, y: 6, z: 6 },
                    materialTag: STATIC_MATERIAL.METAL, // explicit, overrides heuristic
                },
                {
                    type: 'plane', // skipped: not a box
                    position: { x: 0, y: 0, z: 0 },
                    size: { x: 0, y: 0, z: 0 },
                },
            ],
        };

        const count = createWasmTableBoundsForEngine(engine as any, tableConfig);

        expect(engine.clearStatics).toHaveBeenCalledTimes(1);
        expect(engine.addStaticBox).toHaveBeenCalledTimes(3);
        expect(count).toBe(2); // one rejected (-1), not counted

        const materialTags = engine.addStaticBox.mock.calls.map((args) => args[args.length - 1]);
        expect(materialTags).toEqual([
            STATIC_MATERIAL.VELVET,
            STATIC_MATERIAL.WOOD,
            STATIC_MATERIAL.METAL,
        ]);

        // half-extents derived from size/2
        expect(engine.addStaticBox.mock.calls[0].slice(4, 7)).toEqual([1, 1, 1]);
    });
});

describe('addStaticColliderForEngine', () => {
    it('returns -1 immediately when engine is null/undefined, without touching anchor', () => {
        const anchor = new THREE.Object3D();
        const updateSpy = vi.spyOn(anchor, 'updateWorldMatrix');
        const spec = { type: 'box' as const, halfExtents: [1, 1, 1] as [number, number, number] };
        expect(addStaticColliderForEngine(null, spec, anchor)).toBe(-1);
        expect(addStaticColliderForEngine(undefined, spec, anchor)).toBe(-1);
        expect(updateSpy).not.toHaveBeenCalled();
    });
});

describe('removeStaticColliderForEngine / clearStaticCollidersForEngine', () => {
    it('removeStaticColliderForEngine is safe and returns false when engine is null', () => {
        expect(() => removeStaticColliderForEngine(null, 1)).not.toThrow();
        expect(removeStaticColliderForEngine(null, 1)).toBe(false);
        expect(removeStaticColliderForEngine(undefined, 1)).toBe(false);
    });

    it('clearStaticCollidersForEngine is safe (no throw) when engine is null', () => {
        expect(() => clearStaticCollidersForEngine(null)).not.toThrow();
        expect(() => clearStaticCollidersForEngine(undefined)).not.toThrow();
    });
});
