/**
 * The last seeded throw, kept so the roll theatre can seek it: the throw spec
 * (kind, seed, dice), the world it started from (captured by the engine in
 * the same breath as the throw) and which dice were on the table.
 *
 * Only seeded throws are recorded. A cup pour, a flick or a drag moves dice
 * from where the player's hand was, which no seed reproduces, so any of those
 * clears the record rather than leaving a stale one to seek.
 */

import { isReplayActive, recordSeededThrow, replayExit } from '../wasm/PhysicsBridge.js';
import type { ReplayBase, ReplayThrowSpec } from 'dice-core/wasm/replayThrow';
import { spawnedDice } from './DiceState.js';

export interface ThrowRecord {
    spec: ReplayThrowSpec;
    /** Resolves with the pre-throw world; null when the engine could not capture it. */
    base: Promise<ReplayBase | null>;
    /** `base`'s value once it has resolved (undefined until then), for synchronous readers. */
    resolvedBase?: ReplayBase | null;
    /** Engine ids of every die on the table at the throw, in table order. */
    tableIds: number[];
    /** Engine ids that were held (kinematic) at the throw. */
    heldIds: number[];
    /** Increments per throw, so a consumer can tell two throws of one seed apart. */
    serial: number;
}

let last: ThrowRecord | null = null;
let serial = 0;

function tableSignature(): { tableIds: number[]; heldIds: number[] } {
    const tableIds: number[] = [];
    const heldIds: number[] = [];
    for (const die of spawnedDice) {
        if (die.wasmId == null) continue;
        tableIds.push(die.wasmId);
        if (die.kinematic) heldIds.push(die.wasmId);
    }
    return { tableIds, heldIds };
}

/**
 * Hand the table back to the live step if the theatre has it parked. Called
 * before any live input touches the dice (a throw, a grab, a pour): the exit
 * is posted first, so the worker restores the live world before it sees the
 * input, and the in-process bridge restores it synchronously.
 */
export function returnTableToLive(): void {
    if (isReplayActive()) void replayExit();
}

/** Apply a seeded throw through the engine and remember it for seeking. */
export function throwAndRecord(spec: ReplayThrowSpec): ThrowRecord {
    returnTableToLive();
    const signature = tableSignature();
    const base = recordSeededThrow(spec).catch((err) => {
        console.warn('[ThrowRecord] could not capture the pre-throw world:', err);
        return null;
    });
    serial += 1;
    const record: ThrowRecord = { spec, base, ...signature, serial };
    void base.then((value) => {
        record.resolvedBase = value;
    });
    last = record;
    return record;
}

/** A throw no seed reproduces (pour, flick, unseeded): nothing to seek. */
export function forgetLastThrow(): void {
    returnTableToLive();
    last = null;
}

export function getLastThrowRecord(): ThrowRecord | null {
    return last;
}

/**
 * Whether the table still holds exactly the dice the record was thrown over,
 * held the same way. A seek over a different table would rewind into a world
 * the snapshot does not describe.
 */
export function throwRecordMatchesTable(record: ThrowRecord): boolean {
    const now = tableSignature();
    const same = (a: number[], b: number[]) =>
        a.length === b.length && a.every((value, i) => value === b[i]);
    return same(now.tableIds, record.tableIds) && same(now.heldIds, record.heldIds);
}
