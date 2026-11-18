import {
    loadDiceModels,
    spawnObjects,
    updateDiceSet,
    initDiceAppearance,
    getActiveDiceSet,
    setDieAppearance,
    ensureDressedTemplate,
    buildPreviewMaterials,
} from '../dice.js';
import { initUI, createCrosshair } from '../ui.js';
import { createDiceCasePanel } from '../ui/DiceCasePanel.js';
import { initResultsUI } from '../results.js';
import { initInteraction } from '../interaction.js';
import { compileScene, spawnProp, spawnTierWithRandomPool } from '../environment/PropRegistry.js';
import { DEFAULT_SCENE } from '../scenes/index';
import { resolveTableLayoutConfig, persistTableLayoutConfig } from './TableLayoutConfig.js';
import { createLayoutManager } from './RandomLayout.js';
import { preloadSharedTextures } from './TexturePipeline.js';
import { createTierRenderStats } from './TierRenderStats.js';
import { getBootTrace } from './BootTrace.js';
import { createSpawnBudget, resolveSpawnBudgets } from './SpawnBudget.js';
import { precompilePostChain, precompileScene, warmFirstRender } from './ShaderPrecompile.js';

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
    return orchestrator.scheduler.register(
        'updates',
        name,
        ({ deltaTime, time }) => {
            update(deltaTime, time);
        },
        { priority }
    );
}

async function spawnTier(entries, context) {
    for (const [slot, entry] of entries.entries()) {
        await spawnProp(entry, context, { slot });
        // Hands the thread back to a frame once this slice's budget is spent.
        await context.spawnBudget?.checkpoint();
    }
}

/**
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {null} physicsWorld ammo.js was retired; this legacy param is always null now
 * @param {import('../types/app').AppOrchestrator} orchestrator `sceneDocument` is the scene to build (default: the tavern); `renderHold` is main.js's boot hold on the render phase
 * @param {import('../types/app').TierLoadCallbacks} callbacks
 * @param {import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer} renderer
 */
export async function loadTiers(scene, camera, physicsWorld, orchestrator, callbacks, renderer) {
    // The render phase is held (by main.js, from the first frame) while shaders
    // link — see ShaderPrecompile.ts. Released just before the overlay fades;
    // this finally is for a boot that throws.
    const renderHold = orchestrator.renderHold ?? null;
    try {
        return await buildTiers(
            scene,
            camera,
            physicsWorld,
            orchestrator,
            callbacks,
            renderer,
            renderHold
        );
    } finally {
        renderHold?.release();
    }
}

async function buildTiers(
    scene,
    camera,
    physicsWorld,
    orchestrator,
    callbacks,
    renderer,
    renderHold
) {
    const trace = getBootTrace();
    const budgets = resolveSpawnBudgets(new URLSearchParams(window.location.search));
    const spawnBudget = createSpawnBudget({
        scheduler: orchestrator.scheduler,
        budgetMs: budgets.tier0,
        trace,
        label: 'tier0',
    });
    trace.note('spawnBudgetsMs', budgets);
    trace.note('precompile', renderHold !== null);

    /** Link one tier's programs now, with the scene held back from drawing. */
    const precompile = async (label) => {
        if (!renderHold || !renderer) return;
        updateLoadingText('Compiling shaders...');
        try {
            await precompileScene({
                renderer,
                scene,
                camera,
                composer: callbacks.getComposer?.() ?? null,
                label,
                budget: spawnBudget,
                trace,
                onProgress: (done, total) =>
                    updateLoadingText(`Compiling shaders... (${done}/${total})`),
            });
        } catch (error) {
            // Not fatal: the programs still link at first draw, as they used to.
            console.warn(`[BootTrace] shader precompile (${label}) failed`, error);
        }
    };

    const sceneDocument = orchestrator.sceneDocument ?? DEFAULT_SCENE;
    const sceneTiers = compileScene(sceneDocument);
    const layoutConfig = resolveTableLayoutConfig();
    const registerUpdateFn = (name, update, priority = 0) =>
        registerUpdate(orchestrator, name, update, priority);

    const cullingSystem = orchestrator.cullingSystem ?? null;

    const layoutManager = createLayoutManager({
        scene,
        physicsWorld,
        scheduler: orchestrator.scheduler,
        callbacks,
        registerUpdate: registerUpdateFn,
        cullingSystem,
        decorEntries: sceneTiers.decorative,
    });

    const context = {
        scene,
        camera,
        physicsWorld,
        sceneDocument,
        callbacks,
        state: {},
        scheduler: orchestrator.scheduler,
        cullingSystem,
        registerUpdate: registerUpdateFn,
        layoutConfig,
        layoutManager,
        clutterOptions: {
            count: layoutConfig.clutterCount,
            seed: layoutConfig.seed,
            theme: layoutConfig.theme,
        },
        tierRenderStats: createTierRenderStats(scene),
        spawnBudget,
    };

    updateLoadingText('Initializing physics engine...');
    updateLoadingBar(10);

    updateLoadingText('Loading optimized textures...');
    updateLoadingBar(18);
    if (renderer) {
        await trace.spanAsync('textures', 'phase', () => preloadSharedTextures(renderer));
    }

    updateLoadingText(`Building ${sceneDocument.label} environment...`);
    updateLoadingBar(20);
    context.tierRenderStats.snapshotBefore('tier0');
    const endTier0 = trace.beginTier('tier0');
    spawnBudget.configure(budgets.tier0, 'tier0');
    await spawnTier(sceneTiers.tier0, context);
    await precompile('tier0');
    endTier0();
    context.tierRenderStats.snapshotAfter('tier0');
    if (context.state.clutterResult) {
        layoutManager.setInitialClutter(context.state.clutterResult);
    }

    updateLoadingText('Loading dice models...');
    updateLoadingBar(30);
    await trace.spanAsync('dice-models', 'phase', () =>
        loadDiceModels((done, total, label) => {
            const percent = 30 + (done / total) * 10;
            updateLoadingBar(percent);
            if (label) updateLoadingText(`Loading dice models... (${label})`);
        })
    );
    // Awaited so a WebGPU table has its node materials before the first frame;
    // on WebGL this resolves on the same tick.
    await trace.spanAsync('dice-appearance', 'phase', () =>
        initDiceAppearance(scene, {
            renderer,
            envMap: scene.environment ?? null,
            qualityProfile: callbacks.qualityProfile ?? null,
        })
    );
    // spawnObjects() no-ops without WASM (see DiceSpawn.js): dice models stay
    // loaded for the case-panel preview, but no dice are spawned into the
    // scene — a static tavern beats silently running a different simulation.
    trace.span('dice-spawn', 'phase', () => spawnObjects(scene, physicsWorld));

    updateLoadingText('Setting up game...');
    updateLoadingBar(40);

    const endUiPhase = trace.begin('ui', 'phase');
    const ui = initUI(
        (newCounts) => {
            updateDiceSet(scene, physicsWorld, newCounts);
        },
        () => {
            callbacks.onRollAll?.();
        },
        {
            layoutConfig,
            audio: callbacks.audio ?? null,
            onRerollLayout: async (overrides) => {
                const result = await layoutManager.rerollLayout(overrides);
                return result;
            },
            onShareTable: () => layoutManager.getConfig(),
        },
        callbacks.notationHooks ?? null,
        callbacks.rollShareHooks ?? null
    );
    const crosshairUI = createCrosshair();

    initResultsUI();

    const interaction = initInteraction(
        camera,
        scene,
        physicsWorld,
        callbacks.interactionHooks || {}
    );
    callbacks.setInteraction?.(interaction);

    const diceCasePanel = createDiceCasePanel({
        getDiceSet: getActiveDiceSet,
        onEntryChange: (dieKey, patch) => setDieAppearance(dieKey, patch),
        getTemplateMesh: (type) => ensureDressedTemplate(type),
        buildPreviewMaterials,
        getEnvMap: () => scene.environment ?? null,
        getQualityProfile: () => callbacks.qualityProfile ?? callbacks.app?.qualityProfile ?? null,
    });
    orchestrator.scheduler.register(
        'updates',
        'diceCasePreview',
        ({ deltaTime }) => {
            diceCasePanel.updatePreview(deltaTime);
        },
        { priority: -20 }
    );

    endUiPhase();

    updateLoadingText('Loading furniture and props...');
    await yieldToMain();
    updateLoadingBar(55);
    context.tierRenderStats.snapshotBefore('tier1');
    const endTier1 = trace.beginTier('tier1');
    spawnBudget.configure(budgets.tier1, 'tier1');
    await spawnTier(sceneTiers.tier1, context);
    await precompile('tier1');
    endTier1();
    context.tierRenderStats.snapshotAfter('tier1');
    updateLoadingBar(70);

    updateLoadingText('Adding tabletop items...');
    await yieldToMain();
    context.tierRenderStats.snapshotBefore('tierDecor');
    const endDecor = trace.beginTier('decor');
    spawnBudget.configure(budgets.decor, 'decor');
    const decorRecords = await spawnTierWithRandomPool(
        sceneTiers.decorative,
        layoutConfig.decorCount,
        context,
        { seed: layoutConfig.seed + 0xdec0, theme: layoutConfig.theme }
    );
    await precompile('decor');
    if (renderHold && renderer) {
        // The post chain's own programs (bloom blur kernels, vignette, output…): not
        // in the scene, so the passes above never touched them.
        updateLoadingText('Compiling post-processing...');
        try {
            await precompilePostChain({
                renderer,
                composer: callbacks.getComposer?.() ?? null,
                budget: spawnBudget,
                trace,
            });
        } catch (error) {
            console.warn('[BootTrace] post-chain precompile failed', error);
        }
        // Last: one real render, for what three only builds inside render()
        // (shadow-depth programs, first texture / buffer uploads).
        updateLoadingText('Warming up the first frame...');
        try {
            await warmFirstRender({
                renderer,
                scene,
                camera,
                composer: callbacks.getComposer?.() ?? null,
                budget: spawnBudget,
                trace,
            });
        } catch (error) {
            console.warn('[BootTrace] first-render warm-up failed', error);
        }
    }
    endDecor();
    context.tierRenderStats.snapshotAfter('tierDecor');
    layoutManager.setInitialDecor(decorRecords);
    updateLoadingBar(85);

    persistTableLayoutConfig(layoutConfig);

    updateLoadingText('Finalizing...');
    updateLoadingBar(95);

    updateLoadingText('Ready!');
    updateLoadingBar(100);
    await yieldToMain();

    // Every program is linked: let the first frame draw.
    renderHold?.release();

    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.transition = 'opacity 0.5s';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
    }

    if (callbacks.app) {
        callbacks.app.ready = true;
        callbacks.app.events?.emit(callbacks.app.events.AppEvent.APP_READY, { ready: true });
    }
    trace.markReady();
    trace.note('spawnBudget', spawnBudget.stats());
    console.info(`[BootTrace]\n${trace.format()}`);

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
        diceCupProp: context.state.diceCupProp,
        diceTowerProp: context.state.diceTowerProp,
        diceTrayProp: context.state.diceTrayProp,
        diceJailProp: context.state.diceJailProp,
        characterSheetProp: context.state.characterSheetProp,
        tierRenderStats,
        diceCasePanel,
    };
}
