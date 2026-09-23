/**
 * The tower chute, and the headless harness that replays drops through it.
 *
 * `DiceTower.js` builds its meshes and colliders from `diceTowerLayout.ts`, so
 * these are the same boxes the tavern stands up — the point of the module is
 * that the replay harness cannot be testing a hand-copied chute that has since
 * drifted from the one players see.
 */
import { describe, expect, it } from 'vitest';
import {
    DICE_TOWER_DIMENSIONS,
    createDiceTowerColliders,
    createDiceTowerHopper,
    createDiceTowerHopperFrame,
    createDiceTowerParts,
    worldDiceTowerColliders,
} from '../../src/environment/diceTowerLayout.js';
import { runDrop } from '../../scripts/verify-tower-drop-replay.mjs';

const PLACEMENT = { origin: { x: 0, y: -3, z: -14 }, yaw: 0 };

describe('diceTowerLayout', () => {
    it('gives every collider a matching visual part', () => {
        const colliders = createDiceTowerColliders();
        const parts = createDiceTowerParts();
        expect(parts).toHaveLength(colliders.length);
        colliders.forEach((collider, i) => {
            const [w, h, d, x, y, z, rotX] = parts[i]!;
            expect([w, h, d]).toEqual(collider.halfExtents.map((e) => e * 2));
            expect(x).toBe(collider.offset?.x ?? 0);
            expect(y).toBe(collider.offset?.y ?? 0);
            expect(z).toBe(collider.offset?.z ?? 0);
            expect(rotX).toBe(collider.rotation?.x ?? 0);
        });
    });

    it('puts the hopper mouth inside the shaft, above the top ramp', () => {
        const hopper = createDiceTowerHopper();
        const { width, height, depth } = DICE_TOWER_DIMENSIONS;
        expect(hopper.y).toBeLessThan(height);
        expect(hopper.y).toBeGreaterThan(11); // clear of the topmost ramp
        expect(hopper.halfWidth).toBeLessThan(width / 2);
        expect(hopper.halfDepth).toBeLessThan(depth / 2);
    });

    it('yaws colliders about the tower origin, tilt and all', () => {
        const upright = worldDiceTowerColliders(PLACEMENT);
        const turned = worldDiceTowerColliders({ ...PLACEMENT, yaw: Math.PI / 2 });
        expect(turned).toHaveLength(upright.length);

        // Left wall: local -X maps to world +Z under a quarter turn.
        const leftWall = createDiceTowerColliders().findIndex((c) => (c.offset?.x ?? 0) < 0);
        expect(leftWall).toBeGreaterThanOrEqual(0);
        const localX = createDiceTowerColliders()[leftWall]!.offset!.x!;
        expect(turned[leftWall]!.center.x).toBeCloseTo(PLACEMENT.origin.x, 5);
        expect(turned[leftWall]!.center.z).toBeCloseTo(PLACEMENT.origin.z - localX, 5);

        // A tilted ramp keeps its tilt through the yaw (quaternion stays unit).
        const ramp = createDiceTowerColliders().findIndex((c) => (c.rotation?.x ?? 0) > 0);
        const q = turned[ramp]!.rotation;
        expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
        expect(q.x).not.toBeCloseTo(0, 3);
        expect(q.y).not.toBeCloseTo(0, 3);
    });

    it('builds a hopper frame with an orthonormal basis', () => {
        const frame = createDiceTowerHopperFrame({ ...PLACEMENT, yaw: -Math.PI / 6 });
        const { axisX, axisY, axisZ } = frame;
        const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
        const dot = (
            a: { x: number; y: number; z: number },
            b: { x: number; y: number; z: number }
        ) => a.x * b.x + a.y * b.y + a.z * b.z;
        [axisX, axisY, axisZ].forEach((axis) => expect(len(axis)).toBeCloseTo(1, 10));
        expect(dot(axisX, axisZ)).toBeCloseTo(0, 10);
        expect(dot(axisX, axisY)).toBeCloseTo(0, 10);
        expect(frame.origin).toEqual(PLACEMENT.origin);
    });
});

/**
 * A mock of the slice of the engine a drop touches. Real determinism is proved
 * against the WASM solver by `npm run verify:tower-drop-replay`; this keeps the
 * harness's own wiring — collider registration, spawn order, pose application —
 * covered on a machine with no compiled artifacts.
 */
function mockSession() {
    const calls: { statics: number; transforms: number[][]; velocities: number[][] } = {
        statics: 0,
        transforms: [],
        velocities: [],
    };
    let nextId = 1;
    let steps = 0;
    const engine = {
        reset: () => {},
        init: () => {},
        addStaticBox: () => {
            calls.statics++;
            return calls.statics;
        },
        addDie: () => nextId++,
        setDieMaterial: () => {},
        setDieDrag: () => {},
        setDieTransform: (...args: number[]) => calls.transforms.push(args),
        setDieVelocity: (...args: number[]) => calls.velocities.push(args),
        step: () => {
            steps++;
        },
        areAllSettled: () => steps > 3,
        getFaceValues: () => new Int32Array([20, 20, 6]),
        serializeState: () => new Uint8Array([1, 2, 3, steps & 0xff]),
    };
    return { session: { engine, loadHullForDie: () => {} }, calls };
}

describe('verify-tower-drop-replay harness', () => {
    it('registers the whole chute and poses every die once', async () => {
        const { session, calls } = mockSession();
        const result = await runDrop(session, ['d20', 'd20', 'd6'], 1234);

        expect(calls.statics).toBe(createDiceTowerColliders().length);
        expect(calls.transforms).toHaveLength(3);
        expect(calls.velocities).toHaveLength(3);
        expect(result.settled).toBe(true);
        expect(result.faceValues).toEqual([20, 20, 6]);
        expect(result.stateHash).toMatch(/^0x[0-9a-f]+$/);
    });

    it('poses dice at the hopper mouth, not where they were spawned', async () => {
        const { session, calls } = mockSession();
        await runDrop(session, ['d20'], 99);
        const [, , y] = calls.transforms[0]!;
        // Tower origin -3 + hopper mouth 14 — well above the tabletop the die
        // was parked on before the drop.
        expect(y).toBeGreaterThan(10);
        // And falling.
        expect(calls.velocities[0]![2]).toBeLessThan(0);
    });
});
