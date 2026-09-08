import {
    createCoins,
    createBook,
    createD20Holder,
    createGemstone,
    createPotionBottle,
} from './clutter/TabletopItems.js';
import {
    createParchment,
    createTarotCards,
    createWantedPoster,
} from './clutter/DocumentsAndCards.js';
import { createCandle, createQuill } from './clutter/ToolsAndGear.js';
import { asClutter } from './clutter/adaptProp.js';
// Shared prop modules — the clutter registry and PropRegistry spawn the *same*
// geometry and collider spec, differing only in placement and tabletop scale.
import { createMug } from './Mug.js';
import { createPencil } from './Pencil.js';
import { createKey } from './Key.js';
import { createSpyglass } from './Spyglass.js';
import { createMiniature } from './Miniature.js';
import { createSmokingPipe } from './SmokingPipe.js';
import { createDMScreen } from './DMScreen.js';
import { generateClutterSlots } from './clutter/ClutterPlacement.js';
import { createSeededRng, shuffleWithRng } from '../core/SeededRng.js';
import { LAYOUT_THEMES } from '../core/TableLayoutConfig.js';
import { disposeObject3D } from './PropLifecycle.js';
import { mergeScatterHandles } from '../core/StaticPropMerger.js';
import { registerDynamicProp, unregisterDynamicProp } from './DynamicPropState.js';

/**
 * Registry of tabletop clutter factories consumable by the pool selector.
 */
export const CLUTTER_REGISTRY = [
    { id: 'mug', create: asClutter(createMug, { x: 5, z: 5, scale: 0.85 }), weight: 1 },
    { id: 'coins', create: createCoins, weight: 1 },
    { id: 'book', create: createBook, weight: 1 },
    { id: 'parchment', create: createParchment, weight: 1 },
    {
        id: 'pencil',
        create: asClutter(createPencil, { x: 0, z: 4.5, scale: 0.42 }),
        weight: 1,
    },
    { id: 'd20Holder', create: createD20Holder, weight: 1 },
    { id: 'potionBottle', create: createPotionBottle, weight: 1 },
    { id: 'key', create: asClutter(createKey, { x: 2, z: -5, scale: 0.5 }), weight: 1 },
    { id: 'quill', create: createQuill, weight: 1 },
    {
        id: 'pipe',
        create: asClutter(createSmokingPipe, { x: -3.5, z: -5, scale: 0.55 }),
        weight: 1,
    },
    {
        id: 'spyglass',
        create: asClutter(createSpyglass, { x: 0, z: 6, scale: 0.6 }),
        weight: 1,
    },
    { id: 'wantedPoster', create: createWantedPoster, weight: 1 },
    { id: 'tarotCards', create: createTarotCards, weight: 1 },
    { id: 'gemstone', create: createGemstone, weight: 0.35, rare: true, minCount: 6 },
    {
        id: 'miniature',
        create: asClutter(createMiniature, { x: -2, z: 2, scale: 0.9 }),
        weight: 0.3,
        rare: true,
        minCount: 7,
    },
    {
        id: 'dmScreen',
        // Pinned behind the dice zone rather than dropped in a scatter slot.
        create: asClutter(createDMScreen, { x: 0, z: -8, scale: 0.75, placed: false }),
        weight: 0.2,
        rare: true,
        minCount: 8,
        fixed: true,
        seedGate: 0x07,
    },
];

function getThemeWeight(entry, themeId) {
    const theme = LAYOUT_THEMES[themeId];
    if (!theme) return 1;
    if (theme.favorClutter?.includes(entry.id)) return 3;
    if (theme.reduceClutter?.includes(entry.id)) return 0.25;
    return 1;
}

function buildWeightedPool(count, seed, theme, rng) {
    const pool = [];

    for (const entry of CLUTTER_REGISTRY) {
        if (entry.minCount && count < entry.minCount) continue;
        if (entry.seedGate !== undefined && (seed & entry.seedGate) !== 0) continue;
        pool.push({
            ...entry,
            roll: rng() / ((entry.weight ?? 1) * getThemeWeight(entry, theme)),
        });
    }

    pool.sort((a, b) => a.roll - b.roll);

    const seen = new Set();
    const selected = [];
    for (const entry of pool) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        selected.push(entry);
        if (selected.length >= count) break;
    }

    return selected;
}

/**
 * Spawn a sparse, seeded subset of original tier-0 clutter plus the always-on candle.
 */
export function createRandomClutter(scene, physicsWorld, options = {}) {
    const count = Math.max(4, Math.min(10, options.count ?? 7));
    const seed = (options.seed ?? Date.now()) >>> 0;
    const theme = options.theme ?? 'default';
    const rng = createSeededRng(seed);
    const handles = [];
    // Set around each factory call so `track` can stamp provenance on every root
    // it reports — including the clutter-only factories that return nothing.
    let currentEntryId = 'candle';
    const track = (root) => {
        if (!root?.isObject3D) return;
        root.userData.clutterId = currentEntryId;
        handles.push(root);
    };

    const candleData = createCandle(scene, physicsWorld, { rng, track });

    const selected = buildWeightedPool(count, seed, theme, rng);
    shuffleWithRng(selected, rng);

    const mobile = selected.filter((entry) => !entry.fixed);
    const fixed = selected.filter((entry) => entry.fixed);
    const slots = generateClutterSlots(mobile.length, rng);

    // Props that animate or move can't be folded into the static scatter batch,
    // mirroring spawn.js's `!updateHandle && !entry.dynamic` merge rule.
    const propUpdates = [];
    const mergeExcluded = new Set();

    const spawnEntry = (entry, spawnOptions) => {
        currentEntryId = entry.id;
        const result = entry.create(scene, physicsWorld, spawnOptions);
        const root = result?.group ?? (result?.isObject3D ? result : null);

        if (typeof result?.update === 'function') {
            propUpdates.push(result.update);
            if (root) mergeExcluded.add(root);
        }
        if (root?.userData?.isDynamicProp) {
            registerDynamicProp(root);
            mergeExcluded.add(root);
        }
        return result;
    };

    mobile.forEach((entry, index) => {
        const slot = slots[index];
        if (!slot) return;
        spawnEntry(entry, { placement: slot, rng, track });
    });

    fixed.forEach((entry) => {
        spawnEntry(entry, { rng, track });
    });

    const mergeStats = mergeScatterHandles(handles.filter((root) => !mergeExcluded.has(root)));

    // Scheduler updates are invoked as `(deltaTime, time)`; prop `update`
    // callbacks keep whichever of those they were written against.
    const update = (deltaTime, time) => {
        candleData.update(deltaTime, time);
        for (const propUpdate of propUpdates) propUpdate(deltaTime, time);
    };

    return {
        flamePosition: candleData.flamePosition,
        update,
        seed,
        count: selected.length,
        selectedIds: selected.map((entry) => entry.id),
        handles,
        mergeStats,
    };
}

export function despawnRandomClutter(handles, physicsWorld) {
    if (!Array.isArray(handles)) return;
    for (const root of handles) {
        unregisterDynamicProp(root);
        disposeObject3D(root, physicsWorld);
    }
}
