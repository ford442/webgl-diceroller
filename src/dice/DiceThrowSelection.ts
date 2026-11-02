/**
 * Which dice a throw moves. Pure (no Three, no engine) so the rule has a unit
 * test: `throwDice` was "every spawned die" with no way to leave one out, which
 * is why a die parked in the jail — kinematic, skipped by the integrator — was
 * still re-posed and kicked by the next throw.
 */

/** The slice of a spawned die the selection reads. */
export interface ThrowCandidate {
    wasmId?: number | null;
    kinematic?: boolean;
}

/** A die chosen for a throw, in the shape `computeSeededThrowParams` takes. */
export interface ThrowTarget<T extends ThrowCandidate = ThrowCandidate> {
    die: T;
    /** The physics body id (`wasmId`), or the table slot for a body-less die. */
    id: number;
    /** Position within the throw, not on the table: it sets the drop height. */
    index: number;
}

export interface ThrowSelectionOptions {
    /**
     * Physics body ids to throw. Omitted (or null): every die that is not
     * kinematic — today's R key, today's share links. An explicit list throws
     * exactly those dice and skips everyone else, kinematic or not. Naming a
     * die that is still held poses it but the engine will not integrate it, so
     * the caller releases first (the jail's `release(ids)` does).
     */
    ids?: readonly number[] | null;
}

/**
 * The dice a throw moves, in table order. Order is part of the contract: the
 * seeded RNG is drawn once per die in this order, so a replay on another page
 * (same dice set, same spawn order) draws the same pose for the same die.
 */
export function selectThrowDice<T extends ThrowCandidate>(
    dice: readonly T[],
    options: ThrowSelectionOptions = {}
): ThrowTarget<T>[] {
    const wanted = options.ids ? new Set(options.ids) : null;
    const targets: ThrowTarget<T>[] = [];
    dice.forEach((die, slot) => {
        const id = die.wasmId ?? slot;
        if (wanted ? !wanted.has(id) : die.kinematic === true) return;
        targets.push({ die, id, index: targets.length });
    });
    return targets;
}

/**
 * Physics body ids → table slots (positions in the dice set), ascending.
 * Slots are what leaves the page — share links and roll messages — because body
 * ids are handed out per session and name different dice on another page.
 */
export function slotsForDiceIds(dice: readonly ThrowCandidate[], ids: readonly number[]): number[] {
    const wanted = new Set(ids);
    const slots: number[] = [];
    dice.forEach((die, slot) => {
        if (wanted.has(die.wasmId ?? slot)) slots.push(slot);
    });
    return slots;
}

/** Table slots → this page's physics body ids; slots with no die are dropped. */
export function diceIdsForSlots(
    dice: readonly ThrowCandidate[],
    slots: readonly number[]
): number[] {
    const ids: number[] = [];
    for (const slot of slots) {
        const die = dice[slot];
        if (die) ids.push(die.wasmId ?? slot);
    }
    return ids;
}
