import { clearDice } from '../dice.js';
import { hideResults } from '../results.js';
import {
    DECORATIVE_TIER_ENTRIES,
    despawnProp,
    spawnTierWithRandomPool
} from '../environment/PropRegistry.js';
import { createRandomClutter, despawnRandomClutter } from '../environment/RandomClutter.js';
import {
    DENSITY_PRESETS,
    persistTableLayoutConfig,
    resolveTableLayoutConfig
} from './TableLayoutConfig.js';
import { createSeededRng } from '../environment/clutter/ClutterPlacement.js';

function randomInRange([min, max], rng) {
    return min + Math.floor(rng() * (max - min + 1));
}

function resolveCountsForDensity(density, seed) {
    const preset = DENSITY_PRESETS[density] ?? DENSITY_PRESETS.med;
    const rng = createSeededRng((seed >>> 0) + 0xA5A5A5A5);
    return {
        clutterCount: randomInRange(preset.clutter, rng),
        decorCount: randomInRange(preset.decor, rng)
    };
}

export function createLayoutManager({
    scene,
    physicsWorld,
    scheduler,
    callbacks,
    registerUpdate
}) {
    let config = resolveTableLayoutConfig();
    let clutterHandles = [];
    let decorRecords = [];
    let clutterUpdateHandle = null;

    const context = {
        scene,
        physicsWorld,
        callbacks,
        scheduler,
        registerUpdate,
        get layoutConfig() {
            return config;
        }
    };

    function applyClutterResult(result) {
        clutterHandles = result?.handles ?? [];
        clutterUpdateHandle?.dispose?.();
        clutterUpdateHandle = null;
        if (result?.update) {
            clutterUpdateHandle = registerUpdate('clutter', result.update);
        }
        if (result?.flamePosition) {
            callbacks.setCandleFlamePos?.(result.flamePosition);
        }
    }

    async function spawnDecor() {
        decorRecords = await spawnTierWithRandomPool(
            DECORATIVE_TIER_ENTRIES,
            config.decorCount,
            context,
            { seed: config.seed + 0xDEC0, theme: config.theme }
        );
    }

    function despawnDecor() {
        for (const record of decorRecords) {
            despawnProp(record, context);
        }
        decorRecords = [];
    }

    function despawnClutter() {
        despawnRandomClutter(clutterHandles, physicsWorld);
        clutterHandles = [];
        clutterUpdateHandle?.dispose?.();
        clutterUpdateHandle = null;
    }

    async function rerollLayout(overrides = {}) {
        const nextDensity = overrides.density ?? config.density;
        const nextTheme = overrides.theme ?? config.theme;
        const useFreshSeed = overrides.newSeed !== false;
        const nextSeed = overrides.seed
            ?? (useFreshSeed ? ((Math.random() * 0xFFFFFFFF) >>> 0) : config.seed);

        const counts = overrides.clutterCount && overrides.decorCount
            ? { clutterCount: overrides.clutterCount, decorCount: overrides.decorCount }
            : resolveCountsForDensity(nextDensity, nextSeed);

        config = {
            density: nextDensity,
            theme: nextTheme,
            seed: nextSeed >>> 0,
            clutterCount: Math.max(4, Math.min(10, overrides.clutterCount ?? counts.clutterCount)),
            decorCount: Math.max(4, Math.min(15, overrides.decorCount ?? counts.decorCount))
        };

        clearDice(scene, physicsWorld);
        hideResults();

        despawnClutter();
        despawnDecor();

        const clutterResult = createRandomClutter(scene, physicsWorld, {
            count: config.clutterCount,
            seed: config.seed,
            theme: config.theme
        });
        applyClutterResult(clutterResult);

        await spawnDecor();

        persistTableLayoutConfig(config);
        callbacks.onLayoutRerolled?.(config);

        return {
            ...config,
            clutterIds: clutterResult.selectedIds,
            decorCount: decorRecords.length
        };
    }

    return {
        getConfig: () => ({ ...config }),
        setInitialClutter: (result) => applyClutterResult(result),
        setInitialDecor: (records) => {
            decorRecords = records ?? [];
        },
        rerollLayout
    };
}
