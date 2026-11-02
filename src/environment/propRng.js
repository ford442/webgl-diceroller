/**
 * Per-prop seeded RNG (#369).
 *
 * A share link carries `layout-seed`, and a replay is only a replay if the
 * receiver rebuilds the same table — including every collider a prop derives
 * from a random number. So no prop module draws ambient entropy: it draws
 * from the stream the kit hands it, and that stream is a pure function of
 *
 *     (layoutSeed, registry key, slot, ordinal)
 *
 * - `layoutSeed` is the table's `layout-seed`.
 * - the registry key is the tier entry's `name` (`ChairRight`, not `Chair`) or,
 *   on the clutter path, the factory name — so two entries for one factory get
 *   independent streams.
 * - `slot` is where the spawn path placed it: the entry's index in its tier
 *   list, or the clutter scatter slot. Two instances of one prop never share a
 *   stream, even at one position.
 * - `ordinal` counts `createProp` / `propRng` calls inside one factory call, so a
 *   factory that builds two sub-props (a meal's tankard and plate) gets a stream
 *   for each.
 *
 * The spawn paths (`spawnProp`, `RandomClutter`) open a scope around the
 * factory call with {@link withPropScope}; `createProp` claims its stream from
 * the open scope. A factory called with no scope (a unit test, a REPL) still
 * gets a deterministic stream — layout seed 0, slot 0 — never ambient entropy.
 *
 * A factory must claim its stream synchronously, before its first `await`.
 * Every claim in the tree does (`Lamp` is the only async factory and draws
 * none).
 */

import { fnv1a32 } from 'dice-core/hash/fnv1a';
import { createSeededRng } from '../core/SeededRng.js';

/**
 * @typedef {object} PropScope
 * @property {number} layoutSeed the table's `layout-seed`
 * @property {string} key registry key the RNG stream is derived from
 * @property {string} [name] group name the registry gives the prop (the factory name)
 * @property {number | string} [slot] where the spawn path placed it
 * @property {number} [claimed] streams handed out inside this scope so far
 */

/** @type {PropScope | null} */
let activeScope = null;

/**
 * The 32-bit seed behind one prop stream. Exported so tests and tools can name
 * the derivation instead of copying it.
 * @param {number} layoutSeed
 * @param {string} key
 * @param {number | string} [slot]
 * @param {number} [ordinal]
 */
export function derivePropSeed(layoutSeed, key, slot = 0, ordinal = 0) {
    return fnv1a32(`${layoutSeed >>> 0}|${key}|${slot}|${ordinal}`);
}

/**
 * Run `fn` with `scope` open, so every `createProp` / `propRng` inside it draws
 * from a stream keyed to that scope. Synchronous on purpose: the scope is gone
 * when `fn` returns, whatever it returned.
 * @template T
 * @param {{ layoutSeed?: number, key: string, name?: string, slot?: number | string }} scope
 * @param {() => T} fn
 * @returns {T}
 */
export function withPropScope(scope, fn) {
    const previous = activeScope;
    activeScope = {
        layoutSeed: (scope.layoutSeed ?? 0) >>> 0,
        key: scope.key,
        name: scope.name ?? scope.key,
        slot: scope.slot ?? 0,
        claimed: 0,
    };
    try {
        return fn();
    } finally {
        activeScope = previous;
    }
}

/** The scope a factory is being spawned under, or null outside one. */
export function getPropScope() {
    return activeScope;
}

/**
 * Claim this prop's RNG stream. `createProp` calls it for you; call it directly
 * from a factory that does not use the kit, or that needs random numbers before
 * it can declare its colliders (then pass the result to `createProp` as `rng`).
 *
 * @param {string} [label] fallback key outside a scope (the prop's own name)
 * @returns {() => number} a `[0, 1)` generator
 */
export function propRng(label = 'prop') {
    const scope = activeScope;
    if (!scope) return createSeededRng(derivePropSeed(0, label, 0, 0));
    const ordinal = scope.claimed ?? 0;
    scope.claimed = ordinal + 1;
    return createSeededRng(derivePropSeed(scope.layoutSeed, scope.key, scope.slot ?? 0, ordinal));
}

/**
 * Registry name for a `createXxx` factory function (`createMug` → `Mug`), so
 * the clutter path can name a prop the way the tier path does.
 * @param {Function} factory
 * @returns {string}
 */
export function factoryNameOf(factory) {
    return String(factory?.name ?? '').replace(/^create/, '') || 'Prop';
}
