/**
 * applyTableInput — the one place a TableInput (InputLog.ts) becomes engine
 * calls. The rollback simulation, a headless replay of a recorded log and
 * (slice 2 of #366) the worker's live table all go through it, so an input
 * means the same calls in the same order on every peer.
 *
 * Nothing here reads a clock or a random source: an input's numbers are its
 * own, and the only engine state read back is the table itself (a drag
 * without a rotation keeps the body's). The engine PRNG is touched only by
 * `throw` / `towerDrop`, and those seed it first (applyReplayThrow), so its
 * state between inputs is never part of the simulation — which is why a
 * snapshot does not have to carry it.
 */

import { applyReplayThrow, type ReplayThrowEngine } from '../wasm/replayThrow.js';
import { presetForShape } from '../wasm/physicsPresets.js';
import type { DieMaterial, QuatTuple, TableInput, Vec3Tuple } from './InputLog.js';

/** Floats per die / prop in the engine's transform buffers: p.xyz, q.xyzw. */
const TRANSFORM_STRIDE = 7;

/** The engine surface inputs drive (the in-process PhysicsEngine satisfies it). */
export interface TableInputEngine extends ReplayThrowEngine {
    addDie(sides: number, x: number, y: number, z: number): number;
    removeDie(id: number): void;
    setDieMaterial(id: number, friction: number, rollingFriction: number): void;
    setDieDrag(id: number, drag: number): void;
    setDieKinematic(id: number, kinematic: boolean): void;
    setContainerActive(active: boolean): void;
    setContainerPlanes(planes: Float32Array | number[]): void;
    setDynamicKinematic(userId: number, kinematic: boolean): void;
    setDynamicTransform(
        userId: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void;
    applyDynamicImpulse(userId: number, fx: number, fy: number, fz: number): void;
    applyDynamicTorqueImpulse(userId: number, tx: number, ty: number, tz: number): void;
    getDieIds(): Float32Array;
    getTransforms(): Float32Array;
    getDynamicIds(): Float32Array;
    getDynamicTransforms(): Float32Array;
}

/** What only the host knows: how to seed this engine, and where hulls live. */
export interface TableInputHost {
    /** Seed the engine PRNG (a raw Embind engine takes a bigint, a wrapped one a number). */
    seedRng(seed: number): void;
    /** Attach the hull and face table of a `sides`-sided die (hulls.json). */
    attachHull(id: number, sides: number): void;
}

/** The engine preset a spawned die gets when its input names no material. */
export function defaultDieMaterial(sides: number): DieMaterial {
    const preset = presetForShape(`d${sides}`);
    return {
        friction: preset.friction,
        rollingFriction: preset.rollingFriction,
        drag: preset.dragFactor ?? 0,
    };
}

/**
 * Current orientations of the bodies `ids` names, read in one pass. The id
 * buffer is copied before the transform buffer is built: both are views into
 * the WASM heap, and building the second may grow (and detach) it.
 */
function rotationsOf(
    engine: TableInputEngine,
    kind: 'die' | 'prop',
    ids: readonly number[]
): Map<number, QuatTuple> {
    const all = new Float32Array(kind === 'die' ? engine.getDieIds() : engine.getDynamicIds());
    const xf = kind === 'die' ? engine.getTransforms() : engine.getDynamicTransforms();
    const wanted = new Set(ids);
    const out = new Map<number, QuatTuple>();
    for (let i = 0; i < all.length; i++) {
        const id = Math.round(all[i] ?? -1);
        if (!wanted.has(id)) continue;
        const o = i * TRANSFORM_STRIDE + 3;
        out.set(id, [xf[o] ?? 0, xf[o + 1] ?? 0, xf[o + 2] ?? 0, xf[o + 3] ?? 1]);
    }
    return out;
}

function pose(
    engine: TableInputEngine,
    kind: 'die' | 'prop',
    id: number,
    p: Vec3Tuple,
    q: QuatTuple
): void {
    if (kind === 'die') engine.setDieTransform(id, p[0], p[1], p[2], q[0], q[1], q[2], q[3]);
    else engine.setDynamicTransform(id, p[0], p[1], p[2], q[0], q[1], q[2], q[3]);
}

/** Move a body, keeping its own orientation unless `q` is given. Absent ids are a no-op. */
function moveBody(
    engine: TableInputEngine,
    kind: 'die' | 'prop',
    id: number,
    p: Vec3Tuple,
    q?: QuatTuple
): void {
    const rotation = q ?? rotationsOf(engine, kind, [id]).get(id);
    if (rotation) pose(engine, kind, id, p, rotation);
}

function setKinematic(
    engine: TableInputEngine,
    kind: 'die' | 'prop',
    id: number,
    on: boolean
): void {
    if (kind === 'die') engine.setDieKinematic(id, on);
    else engine.setDynamicKinematic(id, on);
}

function kick(
    engine: TableInputEngine,
    kind: 'die' | 'prop',
    id: number,
    impulse?: Vec3Tuple,
    torque?: Vec3Tuple
): void {
    if (impulse) {
        if (kind === 'die') engine.applyImpulse(id, impulse[0], impulse[1], impulse[2]);
        else engine.applyDynamicImpulse(id, impulse[0], impulse[1], impulse[2]);
    }
    if (torque) {
        if (kind === 'die') engine.applyTorqueImpulse(id, torque[0], torque[1], torque[2]);
        else engine.applyDynamicTorqueImpulse(id, torque[0], torque[1], torque[2]);
    }
}

/**
 * Apply one input. A `spawn` returns the die id the engine assigned (-1 when
 * the engine refused it, at capacity); every other input returns null. Ids
 * that name no body are a no-op, the same on every peer.
 */
export function applyTableInput(
    engine: TableInputEngine,
    host: TableInputHost,
    input: TableInput
): number | null {
    switch (input.type) {
        case 'spawn': {
            const [x, y, z] = input.position;
            const id = engine.addDie(input.sides, x, y, z);
            if (id < 0) return id;
            const material = input.material ?? defaultDieMaterial(input.sides);
            engine.setDieMaterial(id, material.friction, material.rollingFriction);
            engine.setDieDrag(id, material.drag);
            host.attachHull(id, input.sides);
            if (input.rotation) pose(engine, 'die', id, input.position, input.rotation);
            return id;
        }
        case 'remove':
            engine.removeDie(input.id);
            return null;
        case 'grab':
            // Kinematic first, as a pointer grab does; the jail then parks it.
            setKinematic(engine, input.body, input.id, true);
            if (input.position) moveBody(engine, input.body, input.id, input.position);
            return null;
        case 'drag':
            moveBody(engine, input.body, input.id, input.position, input.rotation);
            return null;
        case 'release':
            setKinematic(engine, input.body, input.id, false);
            kick(engine, input.body, input.id, input.impulse);
            return null;
        case 'impulse':
            kick(engine, input.body, input.id, input.impulse, input.torque);
            return null;
        case 'cupScoop': {
            const rotations = rotationsOf(
                engine,
                'die',
                input.dice.map((d) => d.id)
            );
            for (const die of input.dice) {
                const rotation = rotations.get(die.id);
                // setDieTransform also zeroes the die's velocity: it lands at rest.
                if (rotation) pose(engine, 'die', die.id, die.position, rotation);
            }
            engine.setContainerPlanes([...input.planes]);
            engine.setContainerActive(true);
            return null;
        }
        case 'cupShake':
            engine.setContainerPlanes([...input.planes]);
            return null;
        case 'cupPour':
            engine.setContainerActive(false);
            return null;
        case 'throw':
            applyReplayThrow(engine, (seed) => host.seedRng(seed), {
                kind: 'throw',
                seed: input.seed,
                dice: [...input.dice],
                tableSurfaceY: input.tableSurfaceY,
            });
            return null;
        case 'towerDrop':
            applyReplayThrow(engine, (seed) => host.seedRng(seed), {
                kind: 'hopper',
                seed: input.seed,
                dice: [...input.dice],
                frame: input.frame,
            });
            return null;
    }
}
