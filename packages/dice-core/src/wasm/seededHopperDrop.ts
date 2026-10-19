/**
 * Shared deterministic parameter generation for a dice-tower hopper drop.
 *
 * The tower version of `seededThrowParams.ts`: the same "one PRNG, one draw
 * order, computed identically on the main thread and inside the worker"
 * contract, but posing dice at the hopper mouth with a small downward
 * velocity instead of firing them across the table with an impulse.
 *
 * A drop is expressed in the tower's own frame (`SeededHopperFrame`) so the
 * PRNG only ever draws unitless scatter — the caller supplies the world-space
 * origin and basis it scatters within, and the same seed reproduces the same
 * poses wherever the tower happens to stand.
 */

import type { SeededDieRef } from './seededThrowParams.js';

/** Downward kick applied to every dropped die, in tower-local units/sec. */
export const HOPPER_DROP_SPEED = 1.5;
/** Peak lateral scatter velocity, tower-local units/sec. */
export const HOPPER_LATERAL_KICK = 0.5;
/** Peak tumble imparted at the hopper mouth, rad/sec. */
export const HOPPER_SPIN = 4.0;
/** Vertical stagger between queued dice so they enter the chute in order. */
export const HOPPER_STACK_SPACING = 0.35;

/**
 * The hopper mouth in world space: an origin plus an orthonormal basis.
 *
 * A basis rather than a 4x4 matrix because both consumers only ever need to
 * map a local offset/velocity out to world space, and three unit vectors are
 * cheap to postMessage and trivially stable to hash into a replay.
 */
export interface SeededHopperFrame {
    /** Tower group origin, world space. */
    origin: { x: number; y: number; z: number };
    /** Tower local +X / +Y / +Z, world space, unit length. */
    axisX: { x: number; y: number; z: number };
    axisY: { x: number; y: number; z: number };
    axisZ: { x: number; y: number; z: number };
    /** Hopper mouth height above the tower origin, tower-local. */
    y: number;
    halfWidth: number;
    halfDepth: number;
}

export interface SeededDropParam {
    id: number;
    x: number;
    y: number;
    z: number;
    qx: number;
    qy: number;
    qz: number;
    qw: number;
    velX: number;
    velY: number;
    velZ: number;
    spinX: number;
    spinY: number;
    spinZ: number;
}

export interface DropParamEngine {
    setDieTransform(
        id: number,
        x: number,
        y: number,
        z: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void;
    setDieVelocity(
        id: number,
        vx: number,
        vy: number,
        vz: number,
        wx: number,
        wy: number,
        wz: number
    ): void;
}

/** THREE.js default Euler order (XYZ) — mirrors `seededThrowParams.ts`. */
function eulerToQuaternion(ex: number, ey: number, ez: number) {
    const c1 = Math.cos(ex / 2);
    const c2 = Math.cos(ey / 2);
    const c3 = Math.cos(ez / 2);
    const s1 = Math.sin(ex / 2);
    const s2 = Math.sin(ey / 2);
    const s3 = Math.sin(ez / 2);
    return {
        qx: s1 * c2 * c3 + c1 * s2 * s3,
        qy: c1 * s2 * c3 - s1 * c2 * s3,
        qz: c1 * c2 * s3 + s1 * s2 * c3,
        qw: c1 * c2 * c3 - s1 * s2 * s3,
    };
}

/**
 * Identity frame at the world origin — the fallback when a caller has no
 * tower loaded, and the frame the unit tests scatter in.
 */
export function identityHopperFrame(y = 0, halfWidth = 1, halfDepth = 1): SeededHopperFrame {
    return {
        origin: { x: 0, y: 0, z: 0 },
        axisX: { x: 1, y: 0, z: 0 },
        axisY: { x: 0, y: 1, z: 0 },
        axisZ: { x: 0, y: 0, z: 1 },
        y,
        halfWidth,
        halfDepth,
    };
}

/**
 * Draw order, per die, in `dice` order — the contract the worker and the
 * main thread both have to honour:
 *   1. lateral X offset, 2. lateral Z offset,
 *   3–5. orientation euler (X, Y, Z),
 *   6. lateral X kick, 7. lateral Z kick,
 *   8–10. tumble (X, Y, Z).
 *
 * The queue stagger (`index * HOPPER_STACK_SPACING`) and the downward kick
 * are constants, not draws: dice have to enter the chute in a fixed order for
 * the drop to look like a drop rather than a shower.
 */
export function computeSeededHopperDropParams(
    rand: () => number,
    dice: SeededDieRef[],
    frame: SeededHopperFrame
): SeededDropParam[] {
    const { origin, axisX, axisY, axisZ } = frame;
    return dice.map(({ id, index }) => {
        const lx = (rand() - 0.5) * 2 * frame.halfWidth;
        const lz = (rand() - 0.5) * 2 * frame.halfDepth;
        const ly = frame.y + index * HOPPER_STACK_SPACING;
        const q = eulerToQuaternion(
            rand() * Math.PI * 2,
            rand() * Math.PI * 2,
            rand() * Math.PI * 2
        );
        const kickX = (rand() - 0.5) * HOPPER_LATERAL_KICK;
        const kickZ = (rand() - 0.5) * HOPPER_LATERAL_KICK;
        const spinX = (rand() - 0.5) * HOPPER_SPIN;
        const spinY = (rand() - 0.5) * HOPPER_SPIN;
        const spinZ = (rand() - 0.5) * HOPPER_SPIN;

        return {
            id,
            x: origin.x + axisX.x * lx + axisY.x * ly + axisZ.x * lz,
            y: origin.y + axisX.y * lx + axisY.y * ly + axisZ.y * lz,
            z: origin.z + axisX.z * lx + axisY.z * ly + axisZ.z * lz,
            ...q,
            velX: axisX.x * kickX + axisY.x * -HOPPER_DROP_SPEED + axisZ.x * kickZ,
            velY: axisX.y * kickX + axisY.y * -HOPPER_DROP_SPEED + axisZ.y * kickZ,
            velZ: axisX.z * kickX + axisY.z * -HOPPER_DROP_SPEED + axisZ.z * kickZ,
            spinX,
            spinY,
            spinZ,
        };
    });
}

/** Apply precomputed drop params to a DicePhysicsEngine (or proxy). */
export function applyDropParams(engine: DropParamEngine, params: SeededDropParam[]): void {
    for (const p of params) {
        engine.setDieTransform(p.id, p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw);
        engine.setDieVelocity(p.id, p.velX, p.velY, p.velZ, p.spinX, p.spinY, p.spinZ);
    }
}
