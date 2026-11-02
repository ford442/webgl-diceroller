/**
 * Records the collider world the page builds in the physics engine, so the
 * tavern can be tested without a browser (#341).
 *
 * Installed under `?test` only (see PhysicsBridge.ts). It wraps the engine's
 * structural methods in place — `init`, `addStatic*` / `removeStatic` /
 * `clearStatics`, `addDynamic*` / `removeDynamic` / `clearDynamics` — and keeps
 * the net live set, which `scripts/export-collider-fixture.mjs` dumps to
 * `tests/fixtures/tavern-world.json`. `solver_tests.cpp` and
 * `applyWorld()` replay that file onto a bare engine.
 *
 * It also keeps a short timestamped log of die adds/removes, which is what a
 * "the engine has 0 dice but the table has 2" failure needs to explain itself.
 */

import { fnv1a64Hex } from '../hash/fnv1a.js';
import type { PhysicsEngine } from './physicsTypes.js';

export const WORLD_FIXTURE_VERSION = 1;

/** Rounded so a fixture regenerated from the same scene is byte-identical. */
const round = (value: number) => {
    const r = Math.round(Number(value) * 1e5) / 1e5;
    return Object.is(r, -0) ? 0 : r;
};
const roundAll = (values: ArrayLike<number>) => Array.from(values, round);

export type WorldStatic =
    | {
          type: 'box';
          id: number;
          center: number[];
          halfExtents: number[];
          rotation: number[];
          material: number;
      }
    | { type: 'plane'; id: number; normal: number[]; dist: number; material: number }
    | {
          type: 'convexHull';
          id: number;
          center: number[];
          rotation: number[];
          vertices: number[];
          material: number;
      }
    | {
          type: 'openCylinder';
          id: number;
          center: number[];
          radius: number;
          halfHeight: number;
          segments: number;
          closedBottom: boolean;
          material: number;
      };

export type WorldDynamic =
    | {
          type: 'box';
          id: number;
          mass: number;
          center: number[];
          halfExtents: number[];
          rotation: number[];
          material: number;
      }
    | {
          type: 'hull';
          id: number;
          mass: number;
          center: number[];
          rotation: number[];
          vertices: number[];
          material: number;
      };

export interface WorldFixture {
    version: number;
    init: { gravity: number; tableY: number; tableHalfW: number; tableHalfD: number } | null;
    statics: WorldStatic[];
    dynamics: WorldDynamic[];
}

export interface DieLogEntry {
    t: number;
    op: 'addDie' | 'removeDie' | 'clearAllDice' | 'init' | 'reset';
    id?: number;
    result?: number;
}

/**
 * The checked-in `tests/fixtures/tavern-world.json`: the recorded world plus
 * the hash it was generated from, so a stale fixture is one string compare and
 * a native test can cite the world it replays.
 */
export interface WorldFixtureFile {
    hash: string;
    world: WorldFixture;
}

export interface WorldRecorder {
    exportWorld(): WorldFixture;
    /** {@link hashWorld} of the live world; memoised until a collider changes. */
    worldHash(): string;
    dieLog(): DieLogEntry[];
}

/**
 * Canonical text of a world, the preimage of {@link hashWorld}.
 *
 * Colliders are described by what they are — shape, pose, material — and
 * sorted, never by the id the page happened to hand out or the order the tiers
 * registered them in: ids come from a global counter that a layout re-roll
 * does not reset, so a client that re-rolled into a layout and a client that
 * loaded it fresh build the same world under different ids. The fixture file
 * keeps ids and id order (the engine replays them); the hash does not.
 */
export function canonicalWorldText(world: WorldFixture): string {
    const describe = <T extends { id: number }>(items: T[]) =>
        items
            .map((item) => {
                const { id: _id, ...shape } = item;
                return JSON.stringify(shape);
            })
            .sort();
    return [
        `world-v${world.version}`,
        JSON.stringify(world.init),
        `statics ${world.statics.length}`,
        ...describe(world.statics),
        `dynamics ${world.dynamics.length}`,
        ...describe(world.dynamics),
    ].join('\n');
}

/**
 * Hash of a collider world: FNV-1a/64 over {@link canonicalWorldText}, 16 hex
 * digits. Two clients with the same hash registered the same colliders (to the
 * 1e-5 the recorder rounds to), which is what a seeded replay needs.
 */
export function hashWorld(world: WorldFixture): string {
    return fnv1a64Hex(canonicalWorldText(world));
}

const DIE_LOG_LIMIT = 200;

type AnyFn = (...args: any[]) => any;

/**
 * Wrap `engine`'s structural methods in place and start recording. Calls are
 * forwarded unchanged; only calls the engine accepted (id >= 0, or `undefined`
 * from a worker proxy that cannot know) are recorded.
 */
export function installWorldRecorder(engine: PhysicsEngine): WorldRecorder {
    const statics = new Map<number, WorldStatic>();
    const dynamics = new Map<number, WorldDynamic>();
    let init: WorldFixture['init'] = null;
    const dieLog: DieLogEntry[] = [];
    const target = engine as unknown as Record<string, AnyFn>;
    // Bumped by every structural change, so `worldHash()` re-hashes only when
    // the world moved (share links and room joins ask for it repeatedly).
    let revision = 0;
    let hashedRevision = -1;
    let hashed = '';

    const log = (entry: Omit<DieLogEntry, 't'>) => {
        dieLog.push({ t: Math.round(performance.now()), ...entry });
        if (dieLog.length > DIE_LOG_LIMIT) dieLog.shift();
    };

    const wrap = (name: string, after: (args: any[], result: any) => void) => {
        const original = target[name];
        if (typeof original !== 'function') return;
        const bound = original.bind(engine);
        target[name] = (...args: any[]) => {
            const result = bound(...args);
            revision++;
            try {
                after(args, result);
            } catch (e) {
                console.warn(`[WorldRecorder] ${name}:`, e);
            }
            return result;
        };
    };
    const accepted = (result: unknown) => result == null || (result as number) >= 0;

    wrap('init', ([gravity, tableY, tableHalfW, tableHalfD]) => {
        init = {
            gravity: round(gravity),
            tableY: round(tableY),
            tableHalfW: round(tableHalfW),
            tableHalfD: round(tableHalfD),
        };
        statics.clear();
        dynamics.clear();
        log({ op: 'init' });
    });
    wrap('reset', () => {
        statics.clear();
        dynamics.clear();
        log({ op: 'reset' });
    });

    wrap('clearStatics', () => statics.clear());
    wrap('removeStatic', ([id]) => statics.delete(id));
    wrap('addStaticBox', ([id, cx, cy, cz, hx, hy, hz, qx, qy, qz, qw, material], result) => {
        if (!accepted(result)) return;
        statics.set(id, {
            type: 'box',
            id,
            center: roundAll([cx, cy, cz]),
            halfExtents: roundAll([hx, hy, hz]),
            rotation: roundAll([qx, qy, qz, qw]),
            material: material ?? 0,
        });
    });
    wrap('addStaticPlane', ([id, nx, ny, nz, dist, material], result) => {
        if (!accepted(result)) return;
        statics.set(id, {
            type: 'plane',
            id,
            normal: roundAll([nx, ny, nz]),
            dist: round(dist),
            material: material ?? 0,
        });
    });
    wrap('addStaticConvexHull', ([id, cx, cy, cz, qx, qy, qz, qw, verts, material], result) => {
        if (!accepted(result)) return;
        statics.set(id, {
            type: 'convexHull',
            id,
            center: roundAll([cx, cy, cz]),
            rotation: roundAll([qx, qy, qz, qw]),
            vertices: flatVertices(verts),
            material: material ?? 0,
        });
    });
    wrap(
        'addStaticOpenCylinder',
        ([id, cx, cy, cz, radius, halfHeight, segments, closedBottom, material], result) => {
            if (!accepted(result)) return;
            statics.set(id, {
                type: 'openCylinder',
                id,
                center: roundAll([cx, cy, cz]),
                radius: round(radius),
                halfHeight: round(halfHeight),
                segments: segments ?? 16,
                closedBottom: !!closedBottom,
                material: material ?? 0,
            });
        }
    );

    wrap('clearDynamics', () => dynamics.clear());
    wrap('removeDynamic', ([id]) => dynamics.delete(id));
    wrap(
        'addDynamicBox',
        ([id, mass, cx, cy, cz, hx, hy, hz, qx, qy, qz, qw, material], result) => {
            if (!accepted(result)) return;
            dynamics.set(id, {
                type: 'box',
                id,
                mass: round(mass),
                center: roundAll([cx, cy, cz]),
                halfExtents: roundAll([hx, hy, hz]),
                rotation: roundAll([qx, qy, qz, qw]),
                material: material ?? 0,
            });
        }
    );
    wrap('addDynamicHull', ([id, mass, cx, cy, cz, qx, qy, qz, qw, verts, material], result) => {
        if (!accepted(result)) return;
        dynamics.set(id, {
            type: 'hull',
            id,
            mass: round(mass),
            center: roundAll([cx, cy, cz]),
            rotation: roundAll([qx, qy, qz, qw]),
            vertices: flatVertices(verts),
            material: material ?? 0,
        });
    });

    wrap('addDie', (_args, result) => log({ op: 'addDie', result }));
    wrap('removeDie', ([id]) => log({ op: 'removeDie', id }));
    wrap('clearAllDice', () => log({ op: 'clearAllDice' }));

    const exportWorld = (): WorldFixture => ({
        // Sorted by id: registration order depends on async tier timing,
        // and the fixture must diff cleanly between runs.
        version: WORLD_FIXTURE_VERSION,
        init,
        statics: [...statics.values()].sort((a, b) => a.id - b.id),
        dynamics: [...dynamics.values()].sort((a, b) => a.id - b.id),
    });

    return {
        exportWorld,
        worldHash(): string {
            if (hashedRevision !== revision) {
                hashed = hashWorld(exportWorld());
                hashedRevision = revision;
            }
            return hashed;
        },
        dieLog: () => dieLog.slice(),
    };
}

/** Embind VectorFloat, typed array, or plain array → rounded plain array. */
function flatVertices(verts: unknown): number[] {
    if (!verts) return [];
    const v = verts as { size?: () => number; get?: (i: number) => number; length?: number };
    if (typeof v.size === 'function' && typeof v.get === 'function') {
        const out: number[] = [];
        for (let i = 0; i < v.size(); i++) out.push(round(v.get(i)));
        return out;
    }
    return roundAll(verts as ArrayLike<number>);
}

/**
 * The text of `tests/fixtures/tavern-world.json`: the hash first, then the
 * world with one collider per line, so a moved prop is a one-line diff.
 */
export function serializeWorldFixtureFile(file: WorldFixtureFile): string {
    const list = (items: unknown[]) =>
        items.length
            ? `[\n${items.map((item) => `   ${JSON.stringify(item)}`).join(',\n')}\n  ]`
            : '[]';
    const { world } = file;
    return (
        `{\n "hash": ${JSON.stringify(file.hash)},\n "world": {\n` +
        `  "version": ${world.version},\n  "init": ${JSON.stringify(world.init)},\n` +
        `  "statics": ${list(world.statics)},\n  "dynamics": ${list(world.dynamics)}\n }\n}\n`
    );
}

/**
 * Parse the fixture file and check its `hash` still names its `world`. A
 * mismatch means the world was hand-edited, or {@link hashWorld} changed
 * without regenerating the fixture — either way the cited hash would lie.
 */
export function parseWorldFixtureFile(text: string): WorldFixtureFile {
    const parsed = JSON.parse(text) as Partial<WorldFixtureFile> | null;
    if (!parsed?.world || typeof parsed.hash !== 'string') {
        throw new Error('world fixture must be { hash, world } — run `npm run fixture:world`');
    }
    const actual = hashWorld(parsed.world);
    if (actual !== parsed.hash) {
        throw new Error(
            `world fixture hash ${parsed.hash} does not match its world (${actual}) — ` +
                'run `npm run fixture:world`'
        );
    }
    return { hash: parsed.hash, world: parsed.world };
}

/**
 * Replay a recorded world onto an engine (after `init`). Used by
 * `rollHeadless(…, { world })` and the tavern-world settle tests.
 */
export function applyWorld(engine: PhysicsEngine, world: WorldFixture): void {
    for (const s of world.statics) {
        switch (s.type) {
            case 'box': {
                const [cx = 0, cy = 0, cz = 0] = s.center;
                const [hx = 0, hy = 0, hz = 0] = s.halfExtents;
                const [qx = 0, qy = 0, qz = 0, qw = 1] = s.rotation;
                engine.addStaticBox(s.id, cx, cy, cz, hx, hy, hz, qx, qy, qz, qw, s.material);
                break;
            }
            case 'plane': {
                const [nx = 0, ny = 1, nz = 0] = s.normal;
                engine.addStaticPlane(s.id, nx, ny, nz, s.dist, s.material);
                break;
            }
            case 'convexHull': {
                const [cx = 0, cy = 0, cz = 0] = s.center;
                const [qx = 0, qy = 0, qz = 0, qw = 1] = s.rotation;
                engine.addStaticConvexHull(
                    s.id,
                    cx,
                    cy,
                    cz,
                    qx,
                    qy,
                    qz,
                    qw,
                    s.vertices,
                    s.material
                );
                break;
            }
            case 'openCylinder': {
                const [cx = 0, cy = 0, cz = 0] = s.center;
                engine.addStaticOpenCylinder(
                    s.id,
                    cx,
                    cy,
                    cz,
                    s.radius,
                    s.halfHeight,
                    s.segments,
                    s.closedBottom,
                    s.material
                );
                break;
            }
        }
    }
    for (const d of world.dynamics) {
        const [cx = 0, cy = 0, cz = 0] = d.center;
        const [qx = 0, qy = 0, qz = 0, qw = 1] = d.rotation;
        if (d.type === 'box') {
            const [hx = 0, hy = 0, hz = 0] = d.halfExtents;
            engine.addDynamicBox(d.id, d.mass, cx, cy, cz, hx, hy, hz, qx, qy, qz, qw, d.material);
        } else {
            engine.addDynamicHull(d.id, d.mass, cx, cy, cz, qx, qy, qz, qw, d.vertices, d.material);
        }
    }
}
