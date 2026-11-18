/**
 * Scripted lockstep tables (#366): input logs over the recorded tavern world,
 * the in-order replay every rollback has to land on, and the golden file that
 * pins it (tests/golden/lockstep.json, `npm run golden:lockstep`).
 *
 * Shared by lockstep.test.ts and scripts/generate-lockstep-goldens.mjs, so the
 * test and the generator replay a log the same way.
 */
import { createHash } from 'node:crypto';
import type { AssetSource } from 'dice-core/assets/AssetSource';
import type { TickInput, TableInput } from 'dice-core/net/InputLog';
import type { TableInputHost } from 'dice-core/net/applyTableInput';
import {
    RollbackSim,
    requireRollbackEngine,
    type RollbackEngine,
    type RollbackSimOptions,
} from 'dice-core/net/RollbackSim';
import { createInProcessPhysicsSession } from 'dice-core/wasm/WasmPhysicsBridge';
import { applyWorld, type WorldFixture } from 'dice-core/wasm/WorldRecorder';
import type { PhysicsEngine } from 'dice-core/wasm/physicsTypes';

export const LOCKSTEP_GOLDEN_PATH = 'tests/golden/lockstep.json';

export interface StateDigest {
    /** serializeState() length. */
    bytes: number;
    /** sha256 of serializeState(), first 16 hex digits. */
    sha256: string;
}

export interface LockstepGoldenScenario {
    name: string;
    /** Ticks the log runs for (the table at this tick is what is pinned). */
    ticks: number;
    records: TickInput[];
    digest: StateDigest;
    /** Face value per die at the end, in engine die order (0 = not resting). */
    faces: number[];
    /** Largest snapshot the in-order run kept. */
    maxSnapshotBytes: number;
}

export interface LockstepGoldenFile {
    version: 1;
    solverRevision: number;
    snapshotVersion: number;
    worldHash: string;
    scenarios: LockstepGoldenScenario[];
}

export function stateDigest(bytes: Uint8Array): StateDigest {
    return {
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
    };
}

/** serializeState() version, from its first four bytes (little-endian u32). */
export function snapshotVersion(bytes: Uint8Array): number {
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
}

// --- tables ------------------------------------------------------------------

/** One peer's engine over the tavern world, reusable across runs (`reset`). */
export interface LockstepTable {
    engine: PhysicsEngine & RollbackEngine;
    host: TableInputHost;
    /** Back to the bare world: no dice, no cup walls, no queued events. */
    reset(): void;
    sim(options?: Omit<RollbackSimOptions, 'host'>): RollbackSim;
}

export async function createLockstepTable(
    world: WorldFixture,
    assets: AssetSource
): Promise<LockstepTable> {
    const session = await createInProcessPhysicsSession({
        assets,
        requireHulls: true,
        quiet: true,
    });
    if (!session.available) throw session.error ?? new Error('WASM engine unavailable');
    const engine = session.engine as PhysicsEngine & RollbackEngine;
    requireRollbackEngine(engine);
    const host: TableInputHost = {
        seedRng: (seed) => engine.seedRNG(seed),
        attachHull: (id, sides) => session.loadHullForDie(id, sides),
    };
    const reset = () => {
        const init = world.init;
        if (!init) throw new Error('world fixture has no init');
        // init() clears dice, props, statics and manifolds; the cup walls are
        // engine state it leaves alone.
        engine.init(init.gravity, init.tableY, init.tableHalfW, init.tableHalfD);
        engine.setContainerActive(false);
        engine.setContainerPlanes([]);
        applyWorld(engine, world);
        engine.getCollisionEvents();
    };
    reset();
    return {
        engine,
        host,
        reset,
        sim: (options = {}) => new RollbackSim(engine, { ...options, host }),
    };
}

export function readFaces(engine: PhysicsEngine): number[] {
    return Array.from(engine.getFaceValues?.() ?? []);
}

/** Every record on time: the table a rollback has to converge to. */
export function replayInOrder(
    table: LockstepTable,
    records: readonly TickInput[],
    ticks: number
): { bytes: Uint8Array; faces: number[]; sim: RollbackSim } {
    table.reset();
    const sim = table.sim();
    const report = sim.submit(records);
    if (report.inserted !== records.length) {
        throw new Error(`in-order replay refused ${records.length - report.inserted} records`);
    }
    sim.advanceTo(ticks);
    return { bytes: sim.stateBytes(), faces: readFaces(table.engine), sim };
}

// --- scenarios ---------------------------------------------------------------

type Vec3 = [number, number, number];

/** Round to millimetres so a log's JSON reads as written. */
const mm = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A dice cup at (cx, cz): eight inward walls of radius `r` and a floor,
 * `[nx, ny, nz, d]` each, interior where `dot(n, p) >= d` (setContainerPlanes).
 */
export function cupPlanes(cx: number, cz: number, floorY: number, r: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const nx = mm(-Math.cos(a));
        const nz = mm(-Math.sin(a));
        const d = mm(nx * (cx + r * Math.cos(a)) + nz * (cz + r * Math.sin(a)));
        out.push(nx === 0 ? 0 : nx, 0, nz === 0 ? 0 : nz, d);
    }
    out.push(0, 1, 0, floorY);
    return out;
}

class Script {
    readonly records: TickInput[] = [];
    private readonly seqs = new Map<number, number>();

    at(tick: number, seat: number, input: TableInput): this {
        const seq = this.seqs.get(seat) ?? 0;
        this.seqs.set(seat, seq + 1);
        this.records.push({ tick, seat, seq, input });
        return this;
    }
}

const TABLE_Y = 1;
/**
 * Holds three d6 side by side with room to spare: walls closer than that
 * squeeze dice into each other, and the overlap outlives the cup.
 */
const CUP_RADIUS = 4;

function spawn(sides: 4 | 6 | 8 | 10 | 12 | 20, position: Vec3): TableInput {
    return { type: 'spawn', sides, position };
}

function dice(...ids: number[]) {
    return ids.map((id, index) => ({ id, index }));
}

export interface LockstepScenario {
    name: string;
    ticks: number;
    build(world: WorldFixture): TickInput[];
}

export const LOCKSTEP_SCENARIOS: LockstepScenario[] = [
    {
        // Seat 0 throws four dice; seat 1 snatches one out of the air, drags
        // it and lets it fly; a prop is knocked and another one carried.
        name: 'throw-grab-drag-release',
        ticks: 480,
        build(world) {
            const [board, cup] = world.dynamics;
            if (!board || !cup) throw new Error('tavern world lost its props');
            const s = new Script()
                .at(0, 0, spawn(20, [-3, 3, 0]))
                .at(0, 0, spawn(6, [-1, 3, 0.5]))
                .at(0, 0, spawn(8, [1, 3, -0.5]))
                .at(0, 0, spawn(12, [3, 3, 0]))
                .at(24, 0, {
                    type: 'throw',
                    seed: 101,
                    dice: dice(0, 1, 2, 3),
                    tableSurfaceY: TABLE_Y,
                })
                .at(60, 1, { type: 'grab', body: 'die', id: 2 });
            for (let k = 0; k < 12; k++) {
                s.at(61 + 3 * k, 1, {
                    type: 'drag',
                    body: 'die',
                    id: 2,
                    position: [mm(2 - 0.25 * k), 4, mm(-1 + 0.1 * k)],
                });
            }
            s.at(97, 1, { type: 'release', body: 'die', id: 2, impulse: [6, 0, 4] }).at(130, 0, {
                type: 'impulse',
                body: 'prop',
                id: board.id,
                impulse: [0.4, 0.2, 0],
                torque: [0, 0.05, 0],
            });
            const [cx = 0, cy = 0, cz = 0] = cup.center;
            s.at(150, 1, { type: 'grab', body: 'prop', id: cup.id });
            for (let k = 0; k < 5; k++) {
                s.at(151 + 4 * k, 1, {
                    type: 'drag',
                    body: 'prop',
                    id: cup.id,
                    position: [mm(cx - 0.2 * k), mm(cy + 0.5), mm(cz + 0.1 * k)],
                });
            }
            s.at(171, 1, { type: 'release', body: 'prop', id: cup.id, impulse: [0.02, 0, 0] });
            return s.records;
        },
    },
    {
        // Three d6 (2.1 units across) scooped into a cup that holds them,
        // shaken and poured. The walls move at a hand's pace (~6 units/s):
        // walls that teleport much faster crush dice into each other.
        name: 'cup-scoop-shake-pour',
        ticks: 540,
        build() {
            const s = new Script()
                .at(0, 0, { ...spawn(6, [-3, 3, 0]), rotation: [0.5, 0.5, 0.5, 0.5] })
                .at(0, 0, { ...spawn(6, [0, 3, 3]), rotation: [0.7071, 0, 0, 0.7071] })
                .at(0, 0, spawn(6, [3, 3, -1]))
                .at(90, 0, {
                    type: 'cupScoop',
                    dice: [
                        { id: 0, position: [-1.5, 2.3, 0.6] },
                        { id: 1, position: [1.5, 2.3, 0.6] },
                        { id: 2, position: [0, 2.3, -1.8] },
                    ],
                    planes: cupPlanes(0, 0, TABLE_Y, CUP_RADIUS),
                });
            for (let k = 0; k < 40; k++) {
                const cx = mm(1.0 * Math.sin(k * 0.15));
                const cz = mm(0.8 * Math.sin(k * 0.11));
                const floor = mm(TABLE_Y + 0.15 * Math.abs(Math.sin(k * 0.5)));
                s.at(91 + 3 * k, 0, {
                    type: 'cupShake',
                    planes: cupPlanes(cx, cz, floor, CUP_RADIUS),
                });
            }
            s.at(220, 0, { type: 'cupPour' });
            return s.records;
        },
    },
    {
        // Dice come and go mid-roll; two are parked in the jail and let go;
        // three go down a seeded hopper drop, and die 4 lands on die 1 —
        // which is then removed, so a rollback from before that has to bring
        // it back, hull and all, for die 4 to land the same. (The grabs and
        // the drop re-pose dice 0 and 3 outright, so an earlier knock would
        // not survive to the end.)
        name: 'spawn-remove-jail-tower',
        ticks: 600,
        build() {
            return new Script()
                .at(0, 0, spawn(4, [-4.5, 3, 0]))
                .at(0, 0, spawn(10, [0, 3, 0]))
                .at(0, 0, spawn(12, [4.5, 3, 0]))
                .at(0, 0, spawn(20, [0, 3, 4.5]))
                .at(20, 0, {
                    type: 'throw',
                    seed: 303,
                    dice: dice(0, 2, 3),
                    tableSurfaceY: TABLE_Y,
                })
                .at(90, 1, spawn(8, [3, 5, -3]))
                .at(150, 1, { type: 'grab', body: 'die', id: 3, position: [-7, 2.4, -6] })
                .at(160, 0, { type: 'grab', body: 'die', id: 0, position: [-4, 2.4, -6] })
                .at(240, 0, { type: 'release', body: 'die', id: 0 })
                .at(240, 1, { type: 'release', body: 'die', id: 3 })
                .at(250, 0, {
                    type: 'towerDrop',
                    seed: 404,
                    dice: dice(0, 3, 4),
                    frame: {
                        origin: { x: 0, y: TABLE_Y, z: 0 },
                        axisX: { x: 1, y: 0, z: 0 },
                        axisY: { x: 0, y: 1, z: 0 },
                        axisZ: { x: 0, y: 0, z: 1 },
                        // The queue stagger is fixed (HOPPER_STACK_SPACING):
                        // the mouth is wide enough that the three do not
                        // start inside one another.
                        y: 6,
                        halfWidth: 2.5,
                        halfDepth: 2.5,
                    },
                })
                .at(400, 1, { type: 'remove', id: 1 })
                .at(410, 0, { type: 'remove', id: 2 }).records;
        },
    },
];
