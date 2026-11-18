/**
 * RollbackSim — a table driven by an InputLog, that takes a late input in its
 * stride (#366). Every peer of a lockstep room runs one over the same log;
 * the solver is deterministic, so they agree on the table without anyone
 * hosting it.
 *
 * The simulation advances one fixed tick at a time: the inputs stamped `t`
 * are applied, then the engine runs tick `t`. Every `snapshotEvery` ticks,
 * before that tick's inputs, it keeps a `serializeState()` snapshot (a ring
 * reaching `maxRollbackTicks` back). An input stamped before the present is
 * late: the engine rewinds to the newest snapshot at or before its tick
 * (`rewindState`, which also brings back dice removed since and drops dice
 * spawned since), and re-runs the log from there to the present. The table
 * then is exactly what it would have been had the input arrived on time —
 * the convergence property test holds it to that, byte for byte.
 *
 * Collision events reach `onEvents` once per tick, the first time that tick
 * runs; a re-simulated tick's events are dropped (they have been heard).
 *
 * Not here (later slices): the clock that decides how many ticks to advance
 * per frame, the per-tick room protocol, smoothing a corrected pose. This is
 * the deterministic core those sit on, and it runs headless in Node.
 */

import { SIM_FIXED_DT } from '../wasm/SimClock.js';
import { applyTableInput, type TableInputEngine, type TableInputHost } from './applyTableInput.js';
import { InputLog, type InsertResult, type TickInput } from './InputLog.js';

export interface RollbackEngine extends TableInputEngine {
    step(dt: number): void;
    serializeState(): Uint8Array;
    rewindState(data: Uint8Array): boolean;
    getDieSides(id: number): number;
    getCollisionEvents(): Float32Array;
}

/** Engine surface as the bridges type it (rewind methods optional on older builds). */
type MaybeRollbackEngine = Omit<RollbackEngine, 'rewindState' | 'getDieSides'> & {
    rewindState?: RollbackEngine['rewindState'];
    getDieSides?: RollbackEngine['getDieSides'];
};

export interface RollbackSimOptions {
    host: TableInputHost;
    /** Ticks between snapshots (default 8: a rollback re-runs at most 7 extra ticks). */
    snapshotEvery?: number;
    /**
     * How far behind the present a late input may be and still be rolled
     * back for (default 120 ticks = 1 s). Older inputs are `tooLate`: the
     * peer needs a resync, not a rollback.
     */
    maxRollbackTicks?: number;
    /** The tick the engine's current state is at (default 0). */
    startTick?: number;
    /** Collision events of a tick that ran for the first time (a copy). */
    onEvents?(tick: number, events: Float32Array): void;
}

export interface SubmitReport {
    /** New records, applied when the simulation reaches their tick (or already, if late). */
    inserted: number;
    duplicates: number;
    /** Records that reuse a `(tick, seat, seq)` with another input; ignored. */
    conflicts: TickInput[];
    /** Records older than any snapshot; ignored — the peer needs a resync. */
    tooLate: TickInput[];
    /** Snapshot tick the table rewound to, or null when nothing was late. */
    rewoundTo: number | null;
    /** Ticks re-run to come back to the present. */
    resimulated: number;
}

export interface RollbackStats {
    rollbacks: number;
    resimulatedTicks: number;
    snapshotsHeld: number;
    lastSnapshotBytes: number;
    maxSnapshotBytes: number;
}

export class LockstepError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LockstepError';
    }
}

/** Bridge engines type the rewind methods as optional; a rollback needs them. */
export function requireRollbackEngine(engine: MaybeRollbackEngine): RollbackEngine {
    if (typeof engine.rewindState !== 'function' || typeof engine.getDieSides !== 'function') {
        throw new LockstepError(
            'This WASM build has no rewindState/getDieSides — rebuild with `npm run build:wasm`.'
        );
    }
    return engine as RollbackEngine;
}

export class RollbackSim {
    readonly log = new InputLog();
    readonly snapshotEvery: number;
    readonly maxRollbackTicks: number;
    private readonly engine: RollbackEngine;
    private readonly host: TableInputHost;
    private readonly onEvents: RollbackSimOptions['onEvents'];
    private readonly startTick: number;
    /** Snapshot per tick, oldest first (Map keeps insertion order; ticks only grow). */
    private snapshots = new Map<number, Uint8Array>();
    private _tick: number;
    /** First tick that has never run: events from below it were already delivered. */
    private freshFrom: number;
    private readonly _stats: RollbackStats = {
        rollbacks: 0,
        resimulatedTicks: 0,
        snapshotsHeld: 0,
        lastSnapshotBytes: 0,
        maxSnapshotBytes: 0,
    };

    constructor(engine: MaybeRollbackEngine, options: RollbackSimOptions) {
        this.engine = requireRollbackEngine(engine);
        this.host = options.host;
        this.onEvents = options.onEvents;
        this.snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? 8));
        this.maxRollbackTicks = Math.max(1, Math.floor(options.maxRollbackTicks ?? 120));
        this.startTick = Math.max(0, Math.floor(options.startTick ?? 0));
        this._tick = this.startTick;
        this.freshFrom = this.startTick;
        // Whatever the engine heard before the first tick is not this table's.
        this.engine.getCollisionEvents();
        this.takeSnapshot(this.startTick);
    }

    /** The next tick to run: inputs stamped below it have been applied. */
    get tick(): number {
        return this._tick;
    }

    /** Oldest tick a late input may name and still be rolled back for. */
    get oldestRewindableTick(): number {
        return this.snapshots.keys().next().value ?? this._tick;
    }

    get stats(): Readonly<RollbackStats> {
        return { ...this._stats, snapshotsHeld: this.snapshots.size };
    }

    /** The table now, as `serializeState()` bytes. */
    stateBytes(): Uint8Array {
        return this.engine.serializeState();
    }

    /**
     * Take records into the log. Ones for the present or later wait for their
     * tick; late ones rewind the table once (to the earliest of them) and
     * re-run it to the present.
     */
    submit(records: TickInput | readonly TickInput[]): SubmitReport {
        const list = Array.isArray(records) ? records : [records as TickInput];
        const report: SubmitReport = {
            inserted: 0,
            duplicates: 0,
            conflicts: [],
            tooLate: [],
            rewoundTo: null,
            resimulated: 0,
        };
        let earliestLate = Infinity;
        for (const rec of list) {
            if (rec.tick < this._tick && rec.tick < this.oldestRewindableTick) {
                report.tooLate.push(rec);
                continue;
            }
            const result: InsertResult = this.log.insert(rec);
            if (result === 'duplicate') report.duplicates++;
            else if (result === 'conflict') report.conflicts.push(rec);
            else {
                report.inserted++;
                if (rec.tick < this._tick) earliestLate = Math.min(earliestLate, rec.tick);
            }
        }
        if (earliestLate !== Infinity) {
            const present = this._tick;
            report.rewoundTo = this.rewindTo(earliestLate);
            report.resimulated = present - this._tick;
            this.runUntil(present);
            this._stats.rollbacks++;
            this._stats.resimulatedTicks += report.resimulated;
        }
        return report;
    }

    /** Run `ticks` fixed ticks forward from the present. */
    advance(ticks = 1): void {
        this.runUntil(this._tick + Math.max(0, Math.floor(ticks)));
    }

    /** Run forward until `tick` is the present (no-op when it already is past). */
    advanceTo(tick: number): void {
        this.runUntil(Math.floor(tick));
    }

    private runUntil(target: number): void {
        while (this._tick < target) this.runTick();
    }

    private runTick(): void {
        const t = this._tick;
        if (t % this.snapshotEvery === 0 && !this.snapshots.has(t)) this.takeSnapshot(t);
        for (const rec of this.log.at(t)) applyTableInput(this.engine, this.host, rec.input);
        this.engine.step(SIM_FIXED_DT);
        // Drained every tick, so a re-run never delivers a stale tick's events.
        const events = this.engine.getCollisionEvents();
        if (t >= this.freshFrom) {
            this.freshFrom = t + 1;
            if (events.length > 0 && this.onEvents) this.onEvents(t, new Float32Array(events));
        }
        this._tick = t + 1;
        this.prune();
    }

    private takeSnapshot(tick: number): void {
        const bytes = this.engine.serializeState();
        this.snapshots.set(tick, bytes);
        this._stats.lastSnapshotBytes = bytes.byteLength;
        this._stats.maxSnapshotBytes = Math.max(this._stats.maxSnapshotBytes, bytes.byteLength);
    }

    /**
     * Restore the newest snapshot at or before `tick` and make it the present.
     * Returns that snapshot's tick.
     */
    private rewindTo(tick: number): number {
        let from = -1;
        for (const t of this.snapshots.keys()) {
            if (t <= tick) from = t;
            else break;
        }
        const bytes = this.snapshots.get(from);
        if (!bytes) throw new LockstepError(`no snapshot at or before tick ${tick}`);

        const before = new Set(Array.from(this.engine.getDieIds(), (id) => Math.round(id)));
        if (!this.engine.rewindState(bytes)) {
            throw new LockstepError(`the engine refused its own snapshot of tick ${from}`);
        }
        // Dice removed since the snapshot came back without a hull.
        for (const raw of Array.from(this.engine.getDieIds())) {
            const id = Math.round(raw);
            if (!before.has(id)) this.host.attachHull(id, this.engine.getDieSides(id));
        }
        // Later snapshots describe a timeline that no longer happened.
        for (const t of [...this.snapshots.keys()]) {
            if (t > from) this.snapshots.delete(t);
        }
        this._tick = from;
        return from;
    }

    /**
     * Keep every snapshot within `maxRollbackTicks` of the present plus the
     * newest one before that window (so any tick in it has a snapshot at or
     * before it), and drop log records no rollback can reach any more.
     */
    private prune(): void {
        const horizon = this._tick - this.maxRollbackTicks;
        let keepFrom: number | null = null;
        for (const t of this.snapshots.keys()) {
            if (t <= horizon) keepFrom = t;
            else break;
        }
        if (keepFrom === null) return;
        for (const t of [...this.snapshots.keys()]) {
            if (t >= keepFrom) break;
            this.snapshots.delete(t);
        }
        this.log.pruneBefore(keepFrom);
    }
}
