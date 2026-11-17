/**
 * replayThrow.ts — the one place a seeded throw is applied to an engine, so a
 * live throw and a scrubber seek of that throw run the same draws in the same
 * order.
 *
 * A replay is `(seed, dice, kind)` plus the world the throw started from. The
 * world is a `serializeState()` snapshot taken *in the same breath* as the
 * throw (no tick may run between them), restored with `restoreMotionState`:
 * pose, velocity, sleep and contacts rewind; hulls, face tables and materials
 * stay. Seeking to tick N is then restore → apply → step N fixed ticks. No
 * transform is stored per tick — the seed is the replay, the snapshot is only
 * where it starts.
 */

import {
    applyThrowParams,
    computeSeededThrowParams,
    type SeededDieRef,
    type ThrowParamEngine,
} from './seededThrowParams.js';
import {
    applyDropParams,
    computeSeededHopperDropParams,
    type SeededHopperFrame,
} from './seededHopperDrop.js';

/** What a seeded throw needs to be applied again: the kind, the seed, the dice. */
export type ReplayThrowSpec =
    | { kind: 'throw'; seed: number; dice: SeededDieRef[]; tableSurfaceY: number }
    | { kind: 'hopper'; seed: number; dice: SeededDieRef[]; frame: SeededHopperFrame };

/** The world a recorded throw started from (captured atomically with the throw). */
export interface ReplayBase {
    /** `serializeState()` taken immediately before the throw was applied. */
    snapshot: Uint8Array;
    /** Engine fixed-tick count at the throw. */
    startTick: number;
}

/** Die poses after a seek or a step; `tick` counts fixed ticks since the throw. */
export interface ReplayFrame {
    tick: number;
    /** Engine die ids, index-aligned with `transforms` (7 floats each: p.xyz, q.xyzw). */
    ids: Float32Array;
    transforms: Float32Array;
}

export interface ReplayThrowEngine extends ThrowParamEngine {
    randomFloat(): number;
}

/**
 * Seed the engine's PRNG and apply `spec`. `seedRng` is passed in because the
 * raw Embind engine takes a bigint and the wrapped one a number.
 */
export function applyReplayThrow(
    engine: ReplayThrowEngine,
    seedRng: (seed: number) => void,
    spec: ReplayThrowSpec
): void {
    seedRng(spec.seed);
    const draw = () => engine.randomFloat();
    if (spec.kind === 'hopper') {
        applyDropParams(engine, computeSeededHopperDropParams(draw, spec.dice, spec.frame));
    } else {
        applyThrowParams(engine, computeSeededThrowParams(draw, spec.dice, spec.tableSurfaceY));
    }
}

/** Copy out of a (possibly zero-copy WASM heap) view before anything steps again. */
export function copyReplayFrame(
    tick: number,
    ids: Float32Array,
    transforms: Float32Array
): ReplayFrame {
    return { tick, ids: new Float32Array(ids), transforms: new Float32Array(transforms) };
}

/** Hard cap on one seek / step request: 60 s of simulated time. */
export const MAX_REPLAY_TICKS = 120 * 60;

export function clampReplayTicks(ticks: number): number {
    if (!Number.isFinite(ticks)) return 0;
    return Math.max(0, Math.min(MAX_REPLAY_TICKS, Math.floor(ticks)));
}
