import { loadDiceModels, spawnObjects, updateDiceSet } from '../dice.js';
import { initUI, createCrosshair } from '../ui.js';
import { initResultsUI } from '../results.js';
import { initInteraction } from '../interaction.js';
import { createFloorAndWalls } from '../physics.js';
import {
    TIER_PROP_DEFINITIONS,
    DECORATIVE_TIER_ENTRIES,
    spawnProp,
    spawnTierWithRandomPool
} from '../environment/PropRegistry.js';
import { resolveTableLayoutConfig, persistTableLayoutConfig } from './TableLayoutConfig.js';
import { createLayoutManager } from './RandomLayout.js';
import { preloadSharedTextures } from './TexturePipeline.js';
import { createTierRenderStats } from './TierRenderStats.js';

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

function updateLoadingBar(percent) {
    const bar = document.getElementById('loading-bar');
    if (bar) bar.style.width = percent + '%';
}

function updateLoadingText(text) {
    const el = document.getElementById('loading-text');
    if (el) el.textContent = text;
}

function registerUpdate(orchestrator, name, update, priority = 0) {
    if (!update) return null;
    return orchestrator.scheduler.register('updates', name, ({ deltaTime, time }) => {
        update(deltaTime, time);
    }, { priority });
}

async function spawnTier(entries, context) {
    for (const entry of entries) {
        await spawnProp(entry, context);
    }
}

export async function loadTiers(scene, camera, physicsWorld, orchestrator, callbacks, renderer) {
    const layoutConfig = resolveTableLayoutConfig();
    const registerUpdateFn = (name, update, priority = 0) => registerUpdate(orchestrator, name, update, priority);

    const cullingSystem = orchestrator.cullingSystem ?? null;

    const layoutManager = createLayoutManager({
        scene,
        physicsWorld,
        scheduler: orchestrator.scheduler,
        callbacks,
        registerUpdate: registerUpdateFn,
        cullingSystem
    });

    const context = {
        scene,
        camera,
        physicsWorld,
        callbacks,
        state: {},
        scheduler: orchestrator.scheduler,
        cullingSystem,
        registerUpdate: registerUpdateFn,
        createFloorAndWalls,
        layoutConfig,
        layoutManager,
        clutterOptions: {
            count: layoutConfig.clutterCount,
            seed: layoutConfig.seed,
            theme: layoutConfig.theme
        },
        tierRenderStats: createTierRenderStats(scene)
    };

    updateLoadingText('Initializing physics engine...');
    updateLoadingBar(10);

    updateLoadingText('Loading optimized textures...');
    updateLoadingBar(18);
    if (renderer) {
        await preloadSharedTextures(renderer);
    }

    updateLoadingText('Building tavern environment...');
    updateLoadingBar(20);
    context.tierRenderStats.snapshotBefore('tier0');
    await spawnTier(TIER_PROP_DEFINITIONS.tier0, context);
    context.tierRenderStats.snapshotAfter('tier0');
    if (context.state.clutterResult) {
        layoutManager.setInitialClutter(context.state.clutterResult);
    }

    updateLoadingText('Loading dice models...');
    updateLoadingBar(30);
    await loadDiceModels((done, total, label) => {
        const percent = 30 + ((done / total) * 10);
        updateLoadingBar(percent);
        if (label) updateLoadingText(`Loading dice models... (${label})`);
    });
    spawnObjects(scene, physicsWorld);

    updateLoadingText('Setting up game...');
    updateLoadingBar(40);

    const ui = initUI(
        (newCounts) => {
            updateDiceSet(scene, physicsWorld, newCounts);
        },
        () => {
            callbacks.onDiceRoll?.();
        },
        {
            layoutConfig,
            audio: callbacks.audio ?? null,
            onRerollLayout: async (overrides) => {
                const result = await layoutManager.rerollLayout(overrides);
                return result;
            },
            onShareTable: () => layoutManager.getConfig()
        }
    );
    const crosshairUI = createCrosshair();

    initResultsUI();

    const interaction = initInteraction(camera, scene, physicsWorld, callbacks.interactionHooks || {});
    callbacks.setInteraction?.(interaction);

    updateLoadingText('Loading furniture and props...');
    await yieldToMain();
    updateLoadingBar(55);
    context.tierRenderStats.snapshotBefore('tier1');
    await spawnTier(TIER_PROP_DEFINITIONS.tier1, context);
    context.tierRenderStats.snapshotAfter('tier1');
    updateLoadingBar(70);

    updateLoadingText('Adding tabletop items...');
    await yieldToMain();
    context.tierRenderStats.snapshotBefore('tierDecor');
    const decorRecords = await spawnTierWithRandomPool(
        DECORATIVE_TIER_ENTRIES,
        layoutConfig.decorCount,
        context,
        { seed: layoutConfig.seed + 0xDEC0, theme: layoutConfig.theme }
    );
    context.tierRenderStats.snapshotAfter('tierDecor');
    layoutManager.setInitialDecor(decorRecords);
    updateLoadingBar(85);

    persistTableLayoutConfig(layoutConfig);

    updateLoadingText('Finalizing...');
    updateLoadingBar(95);

    updateLoadingText('Ready!');
    updateLoadingBar(100);
    await yieldToMain();

    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.transition = 'opacity 0.5s';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
    }

    window.sceneReady = true;

    const tierRenderStats = context.tierRenderStats;
    const tierSummary = tierRenderStats.formatSummary();
    console.info(`[RenderPerf] Per-tier scene cost:\n${tierSummary}`);

    return {
        ui,
        crosshairUI,
        interaction,
        layoutManager,
        lampData: context.state.lampData,
        gongResult: context.state.gongData,
        fireplaceLight: context.state.fireplaceLight,
        tierRenderStats
    };
}
