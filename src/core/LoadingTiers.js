import { loadDiceModels, spawnObjects, updateDiceSet, throwDice } from '../dice.js';
import { initUI, createCrosshair } from '../ui.js';
import { initResultsUI } from '../results.js';
import { initInteraction } from '../interaction.js';
import { createFloorAndWalls } from '../physics.js';
import { SHADOW_DISABLED_PROP_NAMES, TIER_PROP_DEFINITIONS, spawnProp } from '../environment/PropRegistry.js';

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
    if (!update) return;
    orchestrator.scheduler.register('updates', name, ({ deltaTime, time }) => {
        update(deltaTime, time);
    }, { priority });
}

async function spawnTier(entries, context) {
    for (const entry of entries) {
        await spawnProp(entry, context);
    }
}

function finalizeSceneShadows(scene) {
    scene.traverse((child) => {
        if (!child.isMesh) return;

        let parent = child.parent;
        while (parent && parent !== scene) {
            if (parent.name) {
                for (const propName of SHADOW_DISABLED_PROP_NAMES) {
                    if (parent.name.includes(propName)) {
                        child.castShadow = false;
                        return;
                    }
                }
            }
            parent = parent.parent;
        }
    });
}

export async function loadTiers(scene, camera, physicsWorld, orchestrator, callbacks) {
    const context = {
        scene,
        camera,
        physicsWorld,
        callbacks,
        state: {},
        scheduler: orchestrator.scheduler,
        registerUpdate: (name, update, priority = 0) => registerUpdate(orchestrator, name, update, priority),
        createFloorAndWalls
    };

    updateLoadingText('Initializing physics engine...');
    updateLoadingBar(10);

    updateLoadingText('Building tavern environment...');
    updateLoadingBar(20);
    await spawnTier(TIER_PROP_DEFINITIONS.tier0, context);

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
            throwDice(scene, physicsWorld);
            callbacks.onDiceRoll?.();
        }
    );
    const crosshairUI = createCrosshair();

    initResultsUI();

    const interaction = initInteraction(camera, scene, physicsWorld);
    callbacks.setInteraction?.(interaction);

    updateLoadingText('Loading furniture and props...');
    await yieldToMain();
    updateLoadingBar(55);
    await spawnTier(TIER_PROP_DEFINITIONS.tier1, context);
    updateLoadingBar(70);

    updateLoadingText('Adding tabletop items...');
    await yieldToMain();
    await spawnTier(TIER_PROP_DEFINITIONS.tier2, context);
    updateLoadingBar(85);

    updateLoadingText('Adding decorative items...');
    await yieldToMain();
    await spawnTier(TIER_PROP_DEFINITIONS.tier3, context);

    updateLoadingText('Finalizing...');
    updateLoadingBar(95);
    finalizeSceneShadows(scene);

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

    return {
        ui,
        crosshairUI,
        interaction,
        lampData: context.state.lampData,
        gongResult: context.state.gongData,
        fireplaceLight: context.state.fireplaceLight
    };
}
