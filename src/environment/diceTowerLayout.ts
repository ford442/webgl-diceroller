/**
 * Dice tower geometry, free of Three.js.
 *
 * The shaft/ramp/tray dimensions and the collider list used to live inline in
 * `DiceTower.js`. They moved here so the headless harnesses that replay a
 * tower drop (`npm run verify:tower-drop-replay`) can load the *same* chute
 * the tavern builds instead of a hand-copied fixture that quietly drifts —
 * a replay is only worth anything if it runs against the real geometry.
 */

import type { SeededHopperFrame } from '../wasm/seededHopperDrop.js';

export interface DiceTowerColliderSpec {
    type: 'box';
    halfExtents: [number, number, number];
    offset?: { x?: number; y?: number; z?: number };
    rotation?: { x?: number };
}

export interface DiceTowerHopper {
    /** Hopper mouth height above the tower origin, tower-local. */
    y: number;
    halfWidth: number;
    halfDepth: number;
}

export const DICE_TOWER_DIMENSIONS = Object.freeze({
    width: 6,
    depth: 6,
    height: 15,
    thickness: 0.5,
    rampThickness: 0.2,
    trayDepth: 8,
    trayHeight: 2,
});

function derived() {
    const { width, depth, height, thickness, rampThickness, trayDepth, trayHeight } =
        DICE_TOWER_DIMENSIONS;
    return {
        width,
        depth,
        height,
        thickness,
        rampThick: rampThickness,
        trayDepth,
        trayHeight,
        frontH: height / 3,
        rampW: width - thickness * 2 - 0.1,
        rampLen: depth * 0.9,
        trayZ: depth / 2 + trayDepth / 2 - thickness,
    };
}

/**
 * Open top of the shaft, above the zig-zag ramps — the "hopper mouth" dice
 * are posed at for a tower drop; gravity + the ramp colliders do the rest.
 * Tower-local coordinates.
 */
export function createDiceTowerHopper(): DiceTowerHopper {
    const { height, rampW, depth } = derived();
    return {
        y: height - 1.0,
        halfWidth: (rampW / 2) * 0.6,
        halfDepth: depth / 2 - 1,
    };
}

/**
 * Declarative static colliders in tower-local space: shaft walls, the three
 * alternating ramps, and the catch tray.
 */
export function createDiceTowerColliders(): DiceTowerColliderSpec[] {
    const {
        width,
        depth,
        height,
        thickness,
        rampThick,
        rampW,
        rampLen,
        frontH,
        trayDepth,
        trayHeight,
        trayZ,
    } = derived();

    const colliders: DiceTowerColliderSpec[] = [
        {
            type: 'box',
            halfExtents: [width / 2, height / 2, thickness / 2],
            offset: { y: height / 2, z: -depth / 2 + thickness / 2 },
        },
        {
            type: 'box',
            halfExtents: [thickness / 2, height / 2, depth / 2],
            offset: { x: -width / 2 + thickness / 2, y: height / 2 },
        },
        {
            type: 'box',
            halfExtents: [thickness / 2, height / 2, depth / 2],
            offset: { x: width / 2 - thickness / 2, y: height / 2 },
        },
        {
            type: 'box',
            halfExtents: [width / 2, frontH / 2, thickness / 2],
            offset: { y: height - frontH / 2, z: depth / 2 - thickness / 2 },
        },
        {
            type: 'box',
            halfExtents: [rampW / 2, rampThick / 2, rampLen / 2],
            offset: { y: 11, z: -0.5 },
            rotation: { x: 0.6 },
        },
        {
            type: 'box',
            halfExtents: [rampW / 2, rampThick / 2, rampLen / 2],
            offset: { y: 7, z: 0.5 },
            rotation: { x: -0.6 },
        },
        {
            type: 'box',
            halfExtents: [rampW / 2, rampThick / 2, (rampLen + 1) / 2],
            offset: { y: 3, z: -0.5 },
            rotation: { x: 0.6 },
        },
        {
            type: 'box',
            halfExtents: [width / 2, thickness / 2, trayDepth / 2],
            offset: { y: thickness / 2, z: trayZ },
        },
        {
            type: 'box',
            halfExtents: [thickness / 2, trayHeight / 2, trayDepth / 2],
            offset: { x: -width / 2 + thickness / 2, y: trayHeight / 2, z: trayZ },
        },
        {
            type: 'box',
            halfExtents: [thickness / 2, trayHeight / 2, trayDepth / 2],
            offset: { x: width / 2 - thickness / 2, y: trayHeight / 2, z: trayZ },
        },
        {
            type: 'box',
            halfExtents: [width / 2, trayHeight / 2, thickness / 2],
            offset: { y: trayHeight / 2, z: trayZ + trayDepth / 2 - thickness / 2 },
        },
    ];
    return colliders;
}

/** Visual box parts, one per collider: `[w, h, d, x, y, z, rotX]`. */
export function createDiceTowerParts(): [number, number, number, number, number, number, number][] {
    return createDiceTowerColliders().map((collider) => {
        const [hx, hy, hz] = collider.halfExtents;
        const offset = collider.offset ?? {};
        return [
            hx * 2,
            hy * 2,
            hz * 2,
            offset.x ?? 0,
            offset.y ?? 0,
            offset.z ?? 0,
            collider.rotation?.x ?? 0,
        ];
    });
}

// ---------------------------------------------------------------------------
// World placement
//
// The tavern poses the tower through its Three.js group; these helpers do the
// same arithmetic without Three, so a headless harness can register the very
// same colliders (and scatter dice into the same hopper mouth) as the running
// app. Yaw only — the tier definitions place the tower upright.
// ---------------------------------------------------------------------------

export interface TowerPlacement {
    origin: { x: number; y: number; z: number };
    /** Rotation about world +Y, radians. */
    yaw: number;
}

export interface WorldDiceTowerCollider {
    userId: number;
    center: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    halfExtents: [number, number, number];
}

/** Hamilton product, matching `THREE.Quaternion.multiply`. */
function quatMul(
    a: { x: number; y: number; z: number; w: number },
    b: { x: number; y: number; z: number; w: number }
) {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

/**
 * Tower colliders in world space, ready for `engine.addStaticBox`. `userId`
 * counts up from `firstUserId` in collider order.
 */
export function worldDiceTowerColliders(
    placement: TowerPlacement,
    firstUserId = 1
): WorldDiceTowerCollider[] {
    const { origin, yaw } = placement;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const yawQuat = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };

    return createDiceTowerColliders().map((collider, index) => {
        const offset = collider.offset ?? {};
        const lx = offset.x ?? 0;
        const ly = offset.y ?? 0;
        const lz = offset.z ?? 0;
        const tilt = collider.rotation?.x ?? 0;
        return {
            userId: firstUserId + index,
            center: {
                x: origin.x + lx * c + lz * s,
                y: origin.y + ly,
                z: origin.z - lx * s + lz * c,
            },
            rotation: quatMul(yawQuat, {
                x: Math.sin(tilt / 2),
                y: 0,
                z: 0,
                w: Math.cos(tilt / 2),
            }),
            halfExtents: collider.halfExtents,
        };
    });
}

/**
 * The hopper mouth as the world-space origin + orthonormal basis that
 * `computeSeededHopperDropParams` scatters within — the headless twin of
 * `DiceTowerController.hopperFrame()`, which reads the same frame off the
 * live Three.js matrix.
 */
export function createDiceTowerHopperFrame(placement: TowerPlacement): SeededHopperFrame {
    const hopper = createDiceTowerHopper();
    const c = Math.cos(placement.yaw);
    const s = Math.sin(placement.yaw);
    return {
        origin: { ...placement.origin },
        axisX: { x: c, y: 0, z: -s },
        axisY: { x: 0, y: 1, z: 0 },
        axisZ: { x: s, y: 0, z: c },
        y: hopper.y,
        halfWidth: hopper.halfWidth,
        halfDepth: hopper.halfDepth,
    };
}
