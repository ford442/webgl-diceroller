/**
 * The one appearance authority at runtime.
 *
 * Everything that used to ask `DiceAppearanceConfig` for a `{ preset, bodyColor,
 * pipColor }` triple now asks this module for a `DiceSet` entry instead: the
 * renderer, the dice case, multiplayer presence and share links all read the same
 * descriptor, so there is no second source of truth to drift.
 *
 * Deliberately renderer-free — it owns *what* a die looks like, `DiceModels`
 * owns turning that into materials.
 */

import {
    DIE_TYPE_CATALOG,
    createDefaultDiceSet,
    createDefaultEntry,
    normalizeDiceSetEntry,
    resolveFaceValue,
    toLegacyAppearanceConfig,
    withComputedId,
    type DiceSet,
    type DiceSetEntry,
} from './DiceSetFormat.js';
import { LEGACY_LOOK_PARAM, LEGACY_LOOK_PARAM_ALIAS } from './LegacyDiceLook.js';
import {
    DICE_SET_PARAM,
    buildDiceSetPresencePayload,
    encodeDiceSet,
    parseDiceSetPresencePayload,
    persistDiceSet,
    resolveDiceSet,
    type DiceSetPresencePayload,
} from './ShareableDiceSet.js';

export type DiceSetListener = (set: DiceSet, changedKeys: string[]) => void;

let activeSet: DiceSet | null = null;
const listeners = new Set<DiceSetListener>();

/** Every die key that can be put on the table, set members first. */
export function listDieKeys(set: DiceSet | null = activeSet): string[] {
    const keys = new Set<string>(Object.keys(set?.dice ?? {}));
    for (const key of Object.keys(DIE_TYPE_CATALOG)) keys.add(key);
    return [...keys];
}

export function getActiveDiceSet(): DiceSet {
    if (!activeSet) activeSet = resolveDiceSet();
    return activeSet;
}

/**
 * The entry for a die key. Keys the set does not carry but the catalog knows
 * (dF, d2, d100) resolve to that type's curated default rather than to nothing —
 * a derived die is spawnable the moment the catalog lists it.
 */
export function getDieEntry(dieKey: string): DiceSetEntry {
    const set = getActiveDiceSet();
    return set.dice[dieKey] ?? createDefaultEntry(dieKey);
}

/** The mesh a die key rides on — not the same thing as the key itself. */
export function getDieShape(dieKey: string): string {
    return getDieEntry(dieKey).shape;
}

/** Map an as-rolled natural face value onto what the descriptor says it shows. */
export function resolveDieFaceValue(dieKey: string, naturalValue: number): number {
    if (!Number.isFinite(naturalValue) || naturalValue <= 0) return naturalValue;
    return resolveFaceValue(getDieEntry(dieKey), naturalValue);
}

export function subscribeDiceSet(listener: DiceSetListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function emit(set: DiceSet, changedKeys: string[]): void {
    for (const listener of [...listeners]) listener(set, changedKeys);
}

function syncUrl(set: DiceSet): void {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    try {
        const url = new URL(window.location.href);
        url.searchParams.set(DICE_SET_PARAM, encodeDiceSet(set));
        // The v0 token is decode-only now; leaving it would let a stale short
        // code fight the set it was migrated from.
        url.searchParams.delete(LEGACY_LOOK_PARAM);
        url.searchParams.delete(LEGACY_LOOK_PARAM_ALIAS);
        window.history.replaceState({}, '', url);
    } catch {
        // a non-standard location (tests, embedded views) is not worth throwing over
    }
}

export interface SetDiceSetOptions {
    /** Write through to localStorage. Default true. */
    persist?: boolean;
    /** Reflect the set in `?dice-set=`. Default true. */
    url?: boolean;
    /** Keys whose look changed; omit to mean "assume all of them". */
    changedKeys?: string[];
}

export function setActiveDiceSet(set: DiceSet, options: SetDiceSetOptions = {}): DiceSet {
    activeSet = set;
    if (options.persist !== false) persistDiceSet(set);
    if (options.url !== false) syncUrl(set);
    emit(set, options.changedKeys ?? listDieKeys(set));
    return set;
}

/** Resolve URL → storage → defaults and publish the result. */
export function initDiceSetRuntime(searchParams?: URLSearchParams | null): DiceSet {
    // Resolution already honoured the URL, so re-writing it here would only add
    // a token to a link the player did not ask to change.
    return setActiveDiceSet(resolveDiceSet(searchParams), { url: false });
}

/**
 * Patch one die's entry. `patch` is a deep-ish partial — `body`, `faces` and
 * `numbering` merge field-by-field — and the result is re-normalised, so an
 * out-of-range depth or an unknown preset cannot enter the set.
 */
export function updateDieEntry(
    dieKey: string,
    patch: {
        shape?: DiceSetEntry['shape'];
        body?: Partial<DiceSetEntry['body']>;
        faces?: Partial<DiceSetEntry['faces']>;
        numbering?: Partial<DiceSetEntry['numbering']>;
    },
    options: SetDiceSetOptions = {}
): DiceSetEntry {
    const set = getActiveDiceSet();
    const base = getDieEntry(dieKey);
    const merged = normalizeDiceSetEntry(
        {
            shape: patch.shape ?? base.shape,
            body: { ...base.body, ...patch.body },
            faces: { ...base.faces, ...patch.faces },
            numbering: { ...base.numbering, ...patch.numbering },
        },
        dieKey
    );

    setActiveDiceSet(withComputedId({ ...set, dice: { ...set.dice, [dieKey]: merged } }), {
        ...options,
        changedKeys: [dieKey],
    });
    return merged;
}

/** Drop back to the curated defaults. */
export function resetDiceSet(options: SetDiceSetOptions = {}): DiceSet {
    return setActiveDiceSet(createDefaultDiceSet(), options);
}

// ---------------------------------------------------------------------------
// multiplayer presence
// ---------------------------------------------------------------------------

export function buildDiceSetPresence(): DiceSetPresencePayload {
    return buildDiceSetPresencePayload(getActiveDiceSet());
}

/**
 * Adopt a peer's advertised set. A payload whose id disagrees with its content
 * is dropped by the parser, so a peer cannot smuggle in a set it did not hash.
 * Not persisted and not written to the URL: it is their set, not the player's.
 */
export function applyDiceSetPresence(
    presence: Partial<DiceSetPresencePayload> | null | undefined
): DiceSet | null {
    const set = parseDiceSetPresencePayload(presence);
    if (!set) return null;
    return setActiveDiceSet(set, { persist: false, url: false });
}

/** v0 projection, for the last consumers that still speak `{ preset, colours }`. */
export function getLegacyAppearanceConfig(): Record<
    string,
    { preset: string; bodyColor: string; pipColor: string }
> {
    return toLegacyAppearanceConfig(getActiveDiceSet());
}

/** Test seam — drops the cached set and every listener. */
export function resetDiceSetRuntimeForTests(): void {
    activeSet = null;
    listeners.clear();
}
