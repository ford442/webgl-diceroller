/**
 * Dice tower geometry, free of Three.js.
 *
 * The shaft/ramp/tray dimensions and the collider list used to live inline in
 * `DiceTower.js`. They moved here so the headless harnesses that replay a
 * tower drop (`npm run verify:tower-drop-replay`) can load the *same* chute
 * the tavern builds instead of a hand-copied fixture that quietly drifts —
 * a replay is only worth anything if it runs against the real geometry.
 */

import type { SeededHopperFrame } from '../core-engine/wasm/seededHopperDrop.js';

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

/**
 * The narrowest gap a die must fall through on its way down the chute: the
 * d20's circumscribed diameter (2 × 1.11, public/wasm/hulls.json) plus margin.
 * Every ramp but the exit stops this far short of the opposite wall. The old
 * ramps left 0.36–0.77, so a d20 wedged on the first one and a tower drop —
 * a seeded, shareable roll — never finished (#341).
 */
export const CHUTE_MIN_CLEARANCE = 2.4;
/** Ramp pitch about the tower's X axis, radians. */
const RAMP_ANGLE = 0.6;
/** How far each ramp's high end runs into its wall, so nothing slips behind it. */
const RAMP_WALL_EMBED = 0.3;

function derived() {
    const { width, depth, height, thickness, rampThickness, trayDepth, trayHeight } =
        DICE_TOWER_DIMENSIONS;
    // Inner faces of the back and front walls (tower-local z).
    const zBack = -depth / 2 + thickness;
    const zFront = depth / 2 - thickness;
    return {
        width,
        depth,
        height,
        thickness,
        rampThick: rampThickness,
        trayDepth,
        trayHeight,
        zBack,
        zFront,
        frontH: height / 3,
        rampW: width - thickness * 2 - 0.1,
        trayZ: depth / 2 + trayDepth / 2 - thickness,
    };
}

/**
 * A ramp spanning tower-local z from `zHigh` down to `zLow` at RAMP_ANGLE,
 * centred at height `y`. Rotation +x lowers the ramp's +z end.
 */
function ramp(
    y: number,
    zHigh: number,
    zLow: number,
    rampW: number,
    rampThick: number
): DiceTowerColliderSpec {
    const span = Math.abs(zLow - zHigh);
    const halfLen = span / Math.cos(RAMP_ANGLE) / 2;
    return {
        type: 'box',
        halfExtents: [rampW / 2, rampThick / 2, halfLen],
        offset: { y, z: (zHigh + zLow) / 2 },
        rotation: { x: zLow > zHigh ? RAMP_ANGLE : -RAMP_ANGLE },
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
        zBack,
        zFront,
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
        // Zig-zag: back wall → front gap, front wall → back gap, then the
        // exit ramp out through the open lower front into the tray.
        ramp(11, zBack - RAMP_WALL_EMBED, zFront - CHUTE_MIN_CLEARANCE, rampW, rampThick),
        ramp(7, zFront + RAMP_WALL_EMBED, zBack + CHUTE_MIN_CLEARANCE, rampW, rampThick),
        ramp(3, zBack - RAMP_WALL_EMBED, zFront - 0.3, rampW, rampThick),
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

export interface ChuteClearance {
    /** Index into createDiceTowerColliders(). */
    collider: number;
    /** Tower-local z of the ramp's low edge. */
    lowEdgeZ: number;
    /** Horizontal gap from that edge to the opposite wall's inner face. */
    gap: number;
}

/**
 * The gap a die falls through off each ramp but the last (the exit ramp
 * empties into the open front, not against a wall). A gap narrower than the
 * die wedges it, and the drop never settles.
 */
export function computeChuteClearances(): ChuteClearance[] {
    const { zBack, zFront } = derived();
    const colliders = createDiceTowerColliders();
    const ramps = colliders
        .map((collider, index) => ({ collider, index }))
        .filter(({ collider }) => (collider.rotation?.x ?? 0) !== 0);
    return ramps.slice(0, -1).map(({ collider, index }) => {
        const tilt = collider.rotation?.x ?? 0;
        const halfLen = collider.halfExtents[2];
        const z = collider.offset?.z ?? 0;
        // +tilt lowers the +z end; -tilt lowers the -z end.
        const lowEdgeZ = tilt > 0 ? z + halfLen * Math.cos(tilt) : z - halfLen * Math.cos(-tilt);
        const gap = tilt > 0 ? zFront - lowEdgeZ : lowEdgeZ - zBack;
        return { collider: index, lowEdgeZ, gap };
    });
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
