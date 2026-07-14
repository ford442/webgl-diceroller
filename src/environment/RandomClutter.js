import { createMug, createCoins, createBook, createMiniature, createD20Holder, createGemstone, createPotionBottle, createPencil } from './clutter/TabletopItems.js';
import { createParchment, createTarotCards, createWantedPoster, createDMScreen } from './clutter/DocumentsAndCards.js';
import { createCandle, createKey, createQuill, createPipe, createSpyglass } from './clutter/ToolsAndGear.js';
import {
    createSeededRng,
    generateClutterSlots,
    shuffleWithRng
} from './clutter/ClutterPlacement.js';
import { LAYOUT_THEMES } from '../core/TableLayoutConfig.js';
import { disposeObject3D } from './PropLifecycle.js';
import { mergeScatterHandles } from '../core/StaticPropMerger.js';

/**
 * Registry of tabletop clutter factories consumable by the pool selector.
 */
export const CLUTTER_REGISTRY = [
    { id: 'mug', create: createMug, weight: 1 },
    { id: 'coins', create: createCoins, weight: 1 },
    { id: 'book', create: createBook, weight: 1 },
    { id: 'parchment', create: createParchment, weight: 1 },
    { id: 'pencil', create: createPencil, weight: 1 },
    { id: 'd20Holder', create: createD20Holder, weight: 1 },
    { id: 'potionBottle', create: createPotionBottle, weight: 1 },
    { id: 'key', create: createKey, weight: 1 },
    { id: 'quill', create: createQuill, weight: 1 },
    { id: 'pipe', create: createPipe, weight: 1 },
    { id: 'spyglass', create: createSpyglass, weight: 1 },
    { id: 'wantedPoster', create: createWantedPoster, weight: 1 },
    { id: 'tarotCards', create: createTarotCards, weight: 1 },
    { id: 'gemstone', create: createGemstone, weight: 0.35, rare: true, minCount: 6 },
    { id: 'miniature', create: createMiniature, weight: 0.3, rare: true, minCount: 7 },
    { id: 'dmScreen', create: createDMScreen, weight: 0.2, rare: true, minCount: 8, fixed: true, seedGate: 0x07 }
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
            roll: rng() / ((entry.weight ?? 1) * getThemeWeight(entry, theme))
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
    const track = (root) => {
        if (root?.isObject3D) handles.push(root);
    };

    const candleData = createCandle(scene, physicsWorld, { rng, track });

    const selected = buildWeightedPool(count, seed, theme, rng);
    shuffleWithRng(selected, rng);

    const mobile = selected.filter((entry) => !entry.fixed);
    const fixed = selected.filter((entry) => entry.fixed);
    const slots = generateClutterSlots(mobile.length, rng);

    mobile.forEach((entry, index) => {
        const slot = slots[index];
        if (!slot) return;
        entry.create(scene, physicsWorld, { placement: slot, rng, track });
    });

    fixed.forEach((entry) => {
        entry.create(scene, physicsWorld, { rng, track });
    });

    const mergeStats = mergeScatterHandles(handles);

    return {
        flamePosition: candleData.flamePosition,
        update: candleData.update,
        seed,
        count: selected.length,
        selectedIds: selected.map((entry) => entry.id),
        handles,
        mergeStats
    };
}

export function despawnRandomClutter(handles, physicsWorld) {
    if (!Array.isArray(handles)) return;
    for (const root of handles) {
        disposeObject3D(root, physicsWorld);
    }
}
