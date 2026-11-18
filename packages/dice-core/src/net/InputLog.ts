/**
 * InputLog — the lockstep table's inputs (#366): every engine mutation a
 * player can cause, as a typed record stamped with the fixed tick it applies
 * on. A table is its starting world plus this log; two peers that hold the
 * same log hold the same table, because the solver is deterministic.
 *
 * A record is `{ tick, seat, seq, input }`. The inputs stamped `t` are applied
 * just before fixed tick `t` runs (applyTableInput.ts), in `(seat, seq)`
 * order — a total order every peer computes without asking anyone, so two
 * inputs on the same tick land the same way everywhere. `seq` is the seat's
 * own counter; `(tick, seat, seq)` names a record, and receiving it twice is
 * a duplicate, not a second grab.
 *
 * Inputs carry their own numbers: a scoop's die positions, a release's
 * impulse and a throw's seed are resolved by the seat that made them, so
 * applying one never reads a clock, a mouse or `Math.random`. The only engine
 * state an input reads is the table itself (a drag keeps the die's own
 * orientation) — and that is the same on every peer at that tick.
 *
 * Records arrive from other browsers, so `parseTickInput` is a validator, not
 * a cast: unknown types, non-finite or absurd numbers, wrong arities and
 * oversized lists are refused, and what it returns is a fresh object in one
 * canonical key order (its JSON is the record's identity).
 */

import type { SeededDieRef } from '../wasm/seededThrowParams.js';
import type { SeededHopperFrame } from '../wasm/seededHopperDrop.js';

export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

/** A die (engine die id) or a dynamic prop (its collider user id). */
export type BodyKind = 'die' | 'prop';

/** Side counts the engine has hulls for (public/wasm/hulls.json). */
export const SPAWNABLE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type SpawnableSides = (typeof SPAWNABLE_SIDES)[number];

export interface DieMaterial {
    friction: number;
    rollingFriction: number;
    drag: number;
}

export interface ScoopedDie {
    id: number;
    position: Vec3Tuple;
}

export type TableInput =
    /**
     * A new die at `position` (and `rotation`, else identity). It takes the
     * engine's next die id, which is the same on every peer at that tick.
     * `material` defaults to the shape's preset.
     */
    | {
          type: 'spawn';
          sides: SpawnableSides;
          position: Vec3Tuple;
          rotation?: QuatTuple;
          material?: DieMaterial;
      }
    | { type: 'remove'; id: number }
    /**
     * Take hold of a body: kinematic from now on. With `position` it is also
     * moved there (keeping its orientation) — the dice jail's parking.
     */
    | { type: 'grab'; body: BodyKind; id: number; position?: Vec3Tuple }
    /** Move a held body. Without `rotation` it keeps the one it has. */
    | { type: 'drag'; body: BodyKind; id: number; position: Vec3Tuple; rotation?: QuatTuple }
    /** Let go: dynamic again, plus the release `impulse` when there is one. */
    | { type: 'release'; body: BodyKind; id: number; impulse?: Vec3Tuple }
    | { type: 'impulse'; body: BodyKind; id: number; impulse?: Vec3Tuple; torque?: Vec3Tuple }
    /**
     * The dice cup picks dice up: each is placed (orientation kept, at rest)
     * and the cup's walls switch on. `planes` is flat `[nx, ny, nz, d]` per
     * wall, world space, interior where `dot(n, p) >= d`.
     */
    | { type: 'cupScoop'; dice: readonly ScoopedDie[]; planes: readonly number[] }
    /** The cup moved (a shake, or the pour's tilt): its walls follow. */
    | { type: 'cupShake'; planes: readonly number[] }
    /** The cup's walls switch off: what was in it falls out. */
    | { type: 'cupPour' }
    | { type: 'throw'; seed: number; dice: readonly SeededDieRef[]; tableSurfaceY: number }
    | {
          type: 'towerDrop';
          seed: number;
          dice: readonly SeededDieRef[];
          frame: SeededHopperFrame;
      };

export type TableInputType = TableInput['type'];

export interface TickInput {
    /** Fixed tick (1/120 s) the input applies on, before that tick runs. */
    tick: number;
    /** The seat that issued it. */
    seat: number;
    /** That seat's own counter: `(tick, seat, seq)` names the record. */
    seq: number;
    input: TableInput;
}

/** Seats a room may hold (the protocol's seat field is a byte). */
export const MAX_SEATS = 256;
/** Engine die cap (DicePhysicsEngine::MAX_DICE). */
export const MAX_INPUT_DICE = 500;
/** Container walls the engine keeps (DicePhysicsEngine::MAX_CONTAINER_PLANES). */
export const MAX_CUP_PLANES = 9;
/**
 * Largest coordinate, impulse or torque component an input may carry. The
 * table is 36 units across and a hard throw is ~100: this only keeps a
 * griefing peer from launching a die to 1e30, where the solver's products
 * overflow to Infinity.
 */
export const MAX_INPUT_MAGNITUDE = 1e4;
const MAX_TICK = 2 ** 31 - 1;

export class InputLogError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InputLogError';
    }
}

// --- validation -------------------------------------------------------------

type Raw = Record<string, unknown>;

function fail(path: string, why: string): never {
    throw new InputLogError(`${path}: ${why}`);
}

function record(value: unknown, path: string): Raw {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail(path, 'expected an object');
    }
    return value as Raw;
}

function int(value: unknown, path: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        fail(path, `expected an integer in [${min}, ${max}]`);
    }
    return value;
}

function finite(value: unknown, path: string, bound = MAX_INPUT_MAGNITUDE): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > bound) {
        fail(path, `expected a finite number within ±${bound}`);
    }
    // -0 and 0 are the same input; keep one spelling so the JSON is too.
    return value === 0 ? 0 : value;
}

function tuple(value: unknown, path: string, length: number): number[] {
    if (!Array.isArray(value) || value.length !== length) {
        fail(path, `expected ${length} numbers`);
    }
    return value.map((v, i) => finite(v, `${path}[${i}]`));
}

function vec3(value: unknown, path: string): Vec3Tuple {
    return tuple(value, path, 3) as unknown as Vec3Tuple;
}

function quat(value: unknown, path: string): QuatTuple {
    const q = tuple(value, path, 4);
    if (Math.hypot(...q) < 1e-6) fail(path, 'expected a non-zero quaternion');
    return q as unknown as QuatTuple;
}

function optional<T>(raw: Raw, key: string, parse: (value: unknown) => T): T | undefined {
    return raw[key] === undefined ? undefined : parse(raw[key]);
}

function bodyKind(value: unknown, path: string): BodyKind {
    if (value !== 'die' && value !== 'prop') fail(path, "expected 'die' or 'prop'");
    return value;
}

function bodyId(value: unknown, path: string): number {
    return int(value, path, 0, MAX_TICK);
}

function sides(value: unknown, path: string): SpawnableSides {
    if (!SPAWNABLE_SIDES.includes(value as SpawnableSides)) {
        fail(path, `expected one of ${SPAWNABLE_SIDES.join(', ')}`);
    }
    return value as SpawnableSides;
}

function material(value: unknown, path: string): DieMaterial {
    const raw = record(value, path);
    return {
        friction: finite(raw.friction, `${path}.friction`),
        rollingFriction: finite(raw.rollingFriction, `${path}.rollingFriction`),
        drag: finite(raw.drag, `${path}.drag`),
    };
}

function planes(value: unknown, path: string): number[] {
    if (!Array.isArray(value) || value.length % 4 !== 0 || value.length > 4 * MAX_CUP_PLANES) {
        fail(path, `expected up to ${MAX_CUP_PLANES} planes of 4 numbers`);
    }
    return value.map((v, i) => finite(v, `${path}[${i}]`));
}

function list<T>(value: unknown, path: string, parse: (item: unknown, path: string) => T): T[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_INPUT_DICE) {
        fail(path, `expected 1–${MAX_INPUT_DICE} entries`);
    }
    return value.map((item, i) => parse(item, `${path}[${i}]`));
}

function dieRef(value: unknown, path: string): SeededDieRef {
    const raw = record(value, path);
    return {
        id: bodyId(raw.id, `${path}.id`),
        index: int(raw.index, `${path}.index`, 0, MAX_TICK),
    };
}

function scooped(value: unknown, path: string): ScoopedDie {
    const raw = record(value, path);
    return { id: bodyId(raw.id, `${path}.id`), position: vec3(raw.position, `${path}.position`) };
}

function seed(value: unknown, path: string): number {
    return int(value, path, 0, Number.MAX_SAFE_INTEGER);
}

function point(value: unknown, path: string): { x: number; y: number; z: number } {
    const raw = record(value, path);
    return {
        x: finite(raw.x, `${path}.x`),
        y: finite(raw.y, `${path}.y`),
        z: finite(raw.z, `${path}.z`),
    };
}

function hopperFrame(value: unknown, path: string): SeededHopperFrame {
    const raw = record(value, path);
    return {
        origin: point(raw.origin, `${path}.origin`),
        axisX: point(raw.axisX, `${path}.axisX`),
        axisY: point(raw.axisY, `${path}.axisY`),
        axisZ: point(raw.axisZ, `${path}.axisZ`),
        y: finite(raw.y, `${path}.y`),
        halfWidth: finite(raw.halfWidth, `${path}.halfWidth`),
        halfDepth: finite(raw.halfDepth, `${path}.halfDepth`),
    };
}

/** Drop `undefined` optionals so the JSON of an input has one spelling. */
function compact<T extends object>(value: T): T {
    for (const key of Object.keys(value) as (keyof T)[]) {
        if (value[key] === undefined) delete value[key];
    }
    return value;
}

/**
 * Validate an untrusted input and return it as a fresh object in canonical
 * key order. Throws InputLogError naming the first bad field.
 */
export function parseTableInput(value: unknown, path = 'input'): TableInput {
    const raw = record(value, path);
    const at = (key: string) => `${path}.${key}`;
    switch (raw.type) {
        case 'spawn':
            return compact({
                type: 'spawn',
                sides: sides(raw.sides, at('sides')),
                position: vec3(raw.position, at('position')),
                rotation: optional(raw, 'rotation', (v) => quat(v, at('rotation'))),
                material: optional(raw, 'material', (v) => material(v, at('material'))),
            });
        case 'remove':
            return { type: 'remove', id: bodyId(raw.id, at('id')) };
        case 'grab':
            return compact({
                type: 'grab',
                body: bodyKind(raw.body, at('body')),
                id: bodyId(raw.id, at('id')),
                position: optional(raw, 'position', (v) => vec3(v, at('position'))),
            });
        case 'drag':
            return compact({
                type: 'drag',
                body: bodyKind(raw.body, at('body')),
                id: bodyId(raw.id, at('id')),
                position: vec3(raw.position, at('position')),
                rotation: optional(raw, 'rotation', (v) => quat(v, at('rotation'))),
            });
        case 'release':
            return compact({
                type: 'release',
                body: bodyKind(raw.body, at('body')),
                id: bodyId(raw.id, at('id')),
                impulse: optional(raw, 'impulse', (v) => vec3(v, at('impulse'))),
            });
        case 'impulse':
            return compact({
                type: 'impulse',
                body: bodyKind(raw.body, at('body')),
                id: bodyId(raw.id, at('id')),
                impulse: optional(raw, 'impulse', (v) => vec3(v, at('impulse'))),
                torque: optional(raw, 'torque', (v) => vec3(v, at('torque'))),
            });
        case 'cupScoop':
            return {
                type: 'cupScoop',
                dice: list(raw.dice, at('dice'), scooped),
                planes: planes(raw.planes, at('planes')),
            };
        case 'cupShake':
            return { type: 'cupShake', planes: planes(raw.planes, at('planes')) };
        case 'cupPour':
            return { type: 'cupPour' };
        case 'throw':
            return {
                type: 'throw',
                seed: seed(raw.seed, at('seed')),
                dice: list(raw.dice, at('dice'), dieRef),
                tableSurfaceY: finite(raw.tableSurfaceY, at('tableSurfaceY')),
            };
        case 'towerDrop':
            return {
                type: 'towerDrop',
                seed: seed(raw.seed, at('seed')),
                dice: list(raw.dice, at('dice'), dieRef),
                frame: hopperFrame(raw.frame, at('frame')),
            };
        default:
            return fail(at('type'), `unknown input type ${JSON.stringify(raw.type)}`);
    }
}

/** Validate an untrusted record (see parseTableInput). */
export function parseTickInput(value: unknown, path = 'record'): TickInput {
    const raw = record(value, path);
    return {
        tick: int(raw.tick, `${path}.tick`, 0, MAX_TICK),
        seat: int(raw.seat, `${path}.seat`, 0, MAX_SEATS - 1),
        seq: int(raw.seq, `${path}.seq`, 0, MAX_TICK),
        input: parseTableInput(raw.input, `${path}.input`),
    };
}

/** The total order every peer applies inputs in: tick, then seat, then seq. */
export function compareTickInputs(a: TickInput, b: TickInput): number {
    return a.tick - b.tick || a.seat - b.seat || a.seq - b.seq;
}

function recordKey(rec: TickInput): string {
    return `${rec.tick}:${rec.seat}:${rec.seq}`;
}

export type InsertResult =
    /** New: it will be applied at its tick. */
    | 'inserted'
    /** The same record again (a resend): ignored. */
    | 'duplicate'
    /** Same `(tick, seat, seq)`, different input: a broken or lying peer. Ignored. */
    | 'conflict';

/**
 * The records of one table, in apply order. Every record goes through
 * `parseTickInput` on the way in, local ones included, so the log only ever
 * holds canonical, valid inputs.
 */
export class InputLog {
    private readonly records: TickInput[] = [];
    private readonly byKey = new Map<string, string>();

    get size(): number {
        return this.records.length;
    }

    /** Lowest tick still held (Infinity when empty). */
    get firstTick(): number {
        return this.records[0]?.tick ?? Infinity;
    }

    /** Highest tick held (-Infinity when empty). */
    get lastTick(): number {
        return this.records[this.records.length - 1]?.tick ?? -Infinity;
    }

    insert(value: unknown): InsertResult {
        const rec = parseTickInput(value);
        const key = recordKey(rec);
        const json = JSON.stringify(rec.input);
        const seen = this.byKey.get(key);
        if (seen !== undefined) return seen === json ? 'duplicate' : 'conflict';
        this.byKey.set(key, json);
        // Records mostly arrive in order: search from the end.
        let i = this.records.length;
        while (i > 0 && compareTickInputs(this.records[i - 1]!, rec) > 0) i--;
        this.records.splice(i, 0, rec);
        return 'inserted';
    }

    /** The inputs stamped `tick`, in apply order. */
    at(tick: number): TickInput[] {
        const out: TickInput[] = [];
        for (let i = this.lowerBound(tick); i < this.records.length; i++) {
            const rec = this.records[i]!;
            if (rec.tick !== tick) break;
            out.push(rec);
        }
        return out;
    }

    /** Every record with `tick >= from`, in apply order. */
    since(from: number): TickInput[] {
        return this.records.slice(this.lowerBound(from));
    }

    /** Forget every record before `tick` (no rollback can reach them any more). */
    pruneBefore(tick: number): number {
        const n = this.lowerBound(tick);
        for (const rec of this.records.splice(0, n)) this.byKey.delete(recordKey(rec));
        return n;
    }

    toJSON(): TickInput[] {
        return this.records.slice();
    }

    /** A log from JSON records (validated, any order). */
    static from(values: readonly unknown[]): InputLog {
        const log = new InputLog();
        values.forEach((value, i) => {
            if (log.insert(parseTickInput(value, `records[${i}]`)) === 'conflict') {
                throw new InputLogError(`records[${i}]: conflicts with an earlier record`);
            }
        });
        return log;
    }

    private lowerBound(tick: number): number {
        let lo = 0;
        let hi = this.records.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.records[mid]!.tick < tick) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
}
