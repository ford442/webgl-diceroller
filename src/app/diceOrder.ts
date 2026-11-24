/**
 * Put `items` back in the order of a recorded `type` sequence, in place.
 *
 * A table game removes dice it does not play with and `updateDiceSet` re-adds
 * them at the END of `spawnedDice`, so after the game the table was the same
 * multiset in a different order (d6,d4,d8… for d4,d6,d8…). Order is part of the
 * table's identity — `?ids=` share links name dice by slot — so `restore()`
 * re-seats each die at the position its type held before the game.
 *
 * The k-th item of a type takes the position of the k-th occurrence of that
 * type in `sequence`. Items whose type is not in the sequence (or are surplus)
 * keep their relative order after the placed ones. Never throws.
 */
export function reorderToTypeSequence<T extends { type: string }>(
    items: T[],
    sequence: readonly string[]
): void {
    const byType = new Map<string, T[]>();
    for (const item of items) {
        const list = byType.get(item.type);
        if (list) list.push(item);
        else byType.set(item.type, [item]);
    }
    const next: T[] = [];
    const used = new Set<T>();
    for (const type of sequence) {
        const item = byType.get(type)?.shift();
        if (item) {
            next.push(item);
            used.add(item);
        }
    }
    for (const item of items) if (!used.has(item)) next.push(item);
    items.splice(0, items.length, ...next);
}
