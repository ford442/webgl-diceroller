import { loadDiceModels, spawnObjects, updateDiceSet, throwDice } from '../dice.js';
import { initUI, createCrosshair } from '../ui.js';
import { initResultsUI } from '../results.js';
import { initInteraction } from '../interaction.js';
import { createFloorAndWalls } from '../physics.js';
import { TIER_PROP_DEFINITIONS, spawnProp } from '../environment/PropRegistry.js';

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Tunable: total decorative props randomly selected per session */
const MAX_RANDOM_PROPS = 9;

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

/** Fisher-Yates in-place shuffle */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Spawn a tier that contains a mix of "always" props and a random pool.
 * Always props are loaded unconditionally. The random pool is shuffled and
 * capped at `maxRandom` so the table never feels crowded.
 */
async function spawnTierWithRandomPool(entries, maxRandom, context) {
    const always = [];
    const pool = [];
    for (const entry of entries) {
        if (entry.randomPool) {
            pool.push(entry);
        } else {
            always.push(entry);
        }
    }
    shuffleArray(pool);
    const selected = pool.slice(0, Math.max(0, maxRandom));
    const combined = [...always, ...selected];
    for (const entry of combined) {
        await spawnProp(entry, context);
    }
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

    const interaction = initInteraction(camera, scene, physicsWorld, callbacks.interactionHooks || {});
    callbacks.setInteraction?.(interaction);

    updateLoadingText('Loading furniture and props...');
    await yieldToMain();
    updateLoadingBar(55);
    await spawnTier(TIER_PROP_DEFINITIONS.tier1, context);
    updateLoadingBar(70);

    updateLoadingText('Adding tabletop items...');
    await yieldToMain();
    const combinedDecorative = [...TIER_PROP_DEFINITIONS.tier2, ...TIER_PROP_DEFINITIONS.tier3];
    await spawnTierWithRandomPool(combinedDecorative, MAX_RANDOM_PROPS, context);
    updateLoadingBar(85);

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

    return {
        ui,
        crosshairUI,
        interaction,
        lampData: context.state.lampData,
        gongResult: context.state.gongData,
        fireplaceLight: context.state.fireplaceLight
    };
}
