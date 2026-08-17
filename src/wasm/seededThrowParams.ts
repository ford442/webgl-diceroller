/**
 * Shared deterministic throw parameter generation for dice.js and the physics
 * worker. Keeps RNG draw order identical across in-process and worker paths.
 */

export interface SeededDieRef {
    id: number;
    index: number;
}

export interface SeededThrowParam {
    id: number;
    x: number;
    y: number;
    z: number;
    qx: number;
    qy: number;
    qz: number;
    qw: number;
    forceX: number;
    forceY: number;
    forceZ: number;
    spinX: number;
    spinY: number;
    spinZ: number;
}

export interface ThrowParamEngine {
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
    applyImpulse(id: number, fx: number, fy: number, fz: number): void;
    applyTorqueImpulse(id: number, tx: number, ty: number, tz: number): void;
}

/** THREE.js default Euler order (XYZ). */
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

const DEFAULT_RNG_STATE = 0x123456789abcdef0n;
const RNG_MUL = 0x2545f4914f6cdd1dn;

/** xorshift64* PRNG matching DicePhysicsEngine::DeterministicRNG in dice_physics.cpp */
export function createSeededRng(seed: number): () => number {
    let state = BigInt(seed >>> 0) || DEFAULT_RNG_STATE;
    return () => {
        state ^= state >> 12n;
        state ^= state << 25n;
        state ^= state >> 27n;
        state = (state * RNG_MUL) & 0xffffffffffffffffn;
        return Number(state >> 32n) * (1.0 / 4294967296.0);
    };
}

export function computeSeededThrowParams(
    rand: () => number,
    dice: SeededDieRef[],
    tableSurfaceY: number
): SeededThrowParam[] {
    return dice.map(({ id, index }) => {
        const x = (rand() - 0.5) * 4;
        const y = tableSurfaceY + 6.75 + index * 0.5;
        const z = (rand() - 0.5) * 4;
        const q = eulerToQuaternion(
            rand() * Math.PI * 2,
            rand() * Math.PI * 2,
            rand() * Math.PI * 2
        );
        const forceX = (rand() - 0.5) * 25;
        const forceY = rand() * 10 - 5;
        const forceZ = (rand() - 0.5) * 25;
        const spinX = (rand() - 0.5) * 100;
        const spinY = (rand() - 0.5) * 100;
        const spinZ = (rand() - 0.5) * 100;
        return {
            id,
            x,
            y,
            z,
            ...q,
            forceX,
            forceY,
            forceZ,
            spinX,
            spinY,
            spinZ,
        };
    });
}

/** Apply precomputed throw params to a DicePhysicsEngine (or proxy). */
export function applyThrowParams(engine: ThrowParamEngine, params: SeededThrowParam[]): void {
    for (const p of params) {
        engine.setDieTransform(p.id, p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw);
        engine.setDieVelocity(p.id, 0, 0, 0, 0, 0, 0);
        engine.applyImpulse(p.id, p.forceX, p.forceY, p.forceZ);
        engine.applyTorqueImpulse(p.id, p.spinX, p.spinY, p.spinZ);
    }
}
