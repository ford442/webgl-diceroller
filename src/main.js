import * as THREE from 'three';

import { initPhysics, stepPhysics, pollAmmoCollisionEvents, shouldLoadAmmoPhysics } from './physics.js';
import { loadWasmEngine, isWasmAvailable, getWasmEngine, flushWorkerCommandBatch, getWorkerPhysicsStats } from './wasm/PhysicsBridge.js';
import {
    updateDiceVisuals,
    throwDice,
    syncAllDiceToWasm,
    areDiceSettled,
    pollPhysicsCollisionEvents,
    applyDiceMassBiases,
    spawnedDice,
    readAllDiceValues,
    getDiceValueDebugSnapshot,
    replaceDiceSet
} from './dice.js';
import { showResults, hideResults, updateDiceHud, showNotationResults } from './results.js';
import { updateInteraction, interactionNeedsAmmoStep } from './interaction.js';
import { createDiceCollisionAudio } from './audio/DiceCollisionAudio.js';
import { updateAtmosphere } from './environment/Atmosphere.js';
import { setupScene } from './core/SceneSetup.js';
import {
    applyRendererSize,
    createPixelRatioMonitor,
    installRendererRecoveryHandlers,
    recoverRenderer,
    syncComposerPixelRatio
} from './core/RendererFactory.js';
import { LampMode } from './environment/Lamp.js';
import {
    getPropsByTag,
    getPropsByCategory,
    getPropDescriptor,
    getRandomProps,
    getClutterPool,
    getAllTags,
    getAllCategories,
    selectDecorPoolEntries,
    PROP_INDEX
} from './environment/PropRegistry.js';
import { loadTiers } from './core/LoadingTiers.js';
import { setupInput } from './core/InputHandler.js';
import { createCameraController, DiceFocusState } from './core/CameraController.js';
import { createFrameScheduler } from './core/FrameScheduler.js';
import { createCandleFlickerSystem, createFireplaceFlickerSystem } from './core/LightingSystems.js';
import { createFairnessMonitor } from './debug/FairnessMonitor.js';
import { createRollHistory } from './roll/RollHistory.js';
import { createRollStats } from './roll/RollStats.js';
import { createRollHistoryPanel } from './ui/RollHistoryPanel.js';
import { createCullingSystem } from './core/CullingSystem.js';
import { createRenderStats } from './debug/RenderStats.js';
import { createRollSession } from './roll/RollSession.js';

let camera, scene, renderer, composer;
let physicsWorld;
let clock;
let ui, crosshairUI;
let pointLight; // Exposed for flickering
let fireplaceLight; // Fireplace light
let candleFlamePos; // Position of the candle flame
let lampData; // Lamp reference for key handling and rolling state
let gongData; // Gong reference for flash intensity
let gongFlashIntensity = 0; // Screen flash from gong
let interaction; // Interaction handler
const searchParams = new URLSearchParams(window.location.search);
const dualPhysicsValidation = searchParams.has('dual-physics');
const debugEnabled = searchParams.has('debug') || searchParams.has('debug-perf');
const scheduler = createFrameScheduler({
    fixedDeltaTime: 1 / 60,
    maxPhysicsSteps: 5,
    debugPerf: searchParams.has('debug-perf')
});
const cullingSystem = createCullingSystem({ enabled: !searchParams.has('no-cull') });

// Prop library query API — pure module exports, exposed early (independent of the
// async scene load) so it's available from the console for inspecting the 80+ prop
// catalogue and for building themed-table / filtered-clutter features.
window.PropRegistry = {
    getPropsByTag,
    getPropsByCategory,
    getPropDescriptor,
    getRandomProps,
    getClutterPool,
    getAllTags,
    getAllCategories,
    selectDecorPoolEntries,
    PROP_INDEX
};
let postConfig;
let shadowController;
let renderStats = null;
let tierRenderStats = null;
let rendererState;
let rendererBadge = null;
let pixelRatioMonitor = null;
let rendererRecoveryCleanup = null;
let fairnessMonitor = null;
let rollHistory = null;
let rollStats = null;
let rollHistoryPanel = null;
let pendingRollMeta = { seed: null, expression: null, diceSet: {} };
let collisionAudio = null;
let collisionTotal = 0; // running count of collision events, for the debug HUD

function captureDiceSet() {
    const diceSet = {};
    spawnedDice.forEach((die) => {
        diceSet[die.type] = (diceSet[die.type] ?? 0) + 1;
    });
    return diceSet;
}

function beginRoll(seed = null, expression = null) {
    pendingRollMeta = {
        seed: seed ?? null,
        expression: expression ?? null,
        diceSet: captureDiceSet()
    };
    shadowController?.pulse('roll');
    throwDice(scene, physicsWorld, seed);
    cameraController?.setState(DiceFocusState.WAITING_FOR_STOP);
    hideResults();
    if (lampData) lampData.setRolling(true);
}

function handleResultsReady(results) {
    rollHistory?.appendRoll(results, pendingRollMeta);
    rollStats?.recordResults(results);
    fairnessMonitor?.render();
    rollHistoryPanel?.refresh();
    pendingRollMeta = { seed: null, expression: null, diceSet: {} };
}

// "Eye-Head" Cursor Logic
const cursorPos = new THREE.Vector2(0, 0); // Pixel coordinates relative to center
const isLockedRef = { value: false };

let cameraController;
let inputState;

function createShadowController(rendererRef, sceneRef) {
    const state = {
        externalMotionCount: 0,
        settleStartedAtMs: null,
        staticShadowRefreshes: 0,
        lastReason: 'startup'
    };

    const markShadowLightsDirty = () => {
        sceneRef.traverse((child) => {
            if (child.isLight && child.castShadow && child.shadow) {
                child.shadow.needsUpdate = true;
            }
        });
    };

    const enable = (reason = 'motion') => {
        state.lastReason = reason;
        rendererRef.shadowMap.autoUpdate = true;
        rendererRef.shadowMap.needsUpdate = true;
        markShadowLightsDirty();
    };

    const requestStaticRefresh = (reason = 'settled') => {
        state.lastReason = reason;
        rendererRef.shadowMap.autoUpdate = false;
        rendererRef.shadowMap.needsUpdate = true;
        markShadowLightsDirty();
        state.staticShadowRefreshes += 1;
    };

    return {
        state,
        noteMotionStart(reason = 'motion') {
            state.externalMotionCount += 1;
            state.settleStartedAtMs = null;
            enable(reason);
        },
        pulse(reason = 'motion') {
            state.settleStartedAtMs = null;
            enable(reason);
        },
        noteMotionEnd(reason = 'motion') {
            state.externalMotionCount = Math.max(0, state.externalMotionCount - 1);
            state.lastReason = reason;
        },
        forceRefresh(reason = 'manual') {
            requestStaticRefresh(reason);
        },
        update(timeMs, diceSettled) {
            const dynamicMotion = state.externalMotionCount > 0 || !diceSettled;
            if (dynamicMotion) {
                state.settleStartedAtMs = null;
                enable('dynamic');
                return;
            }

            if (state.settleStartedAtMs === null) {
                state.settleStartedAtMs = timeMs;
                return;
            }

            if ((timeMs - state.settleStartedAtMs) >= 500 && rendererRef.shadowMap.autoUpdate) {
                requestStaticRefresh('settled');
            }
        }
    };
}

// Small, unobtrusive indicator of the active renderer. Shown when ?debug is on,
// when ?renderer-info is requested, or whenever WebGPU fell back to WebGL so the
// user understands they're on the degraded baseline path. In the happy WebGPU
// case (no debug) nothing is shown, keeping the UI clean.
function createRendererBadge(state, { persistent } = {}) {
    const container = document.getElementById('canvas-container') || document.body;
    const badge = document.createElement('div');
    badge.style.position = 'absolute';
    badge.style.bottom = '10px';
    badge.style.left = '10px';
    badge.style.fontFamily = 'monospace';
    badge.style.fontSize = '11px';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '5px';
    badge.style.zIndex = '1100';
    badge.style.pointerEvents = 'none';
    badge.style.transition = 'opacity 0.6s ease, background-color 0.3s ease';
    badge.style.maxWidth = 'min(90vw, 420px)';
    badge.style.lineHeight = '1.35';
    container.appendChild(badge);

    const fadeTimers = [];

    function applyState(nextState, { status, message } = {}) {
        const isFallback = Boolean(nextState?.fallbackReason);
        const type = nextState?.rendererType ?? 'webgl';
        const contextLost = nextState?.contextStatus === 'lost' || status === 'lost';
        const recovering = status === 'recovering';

        if (contextLost) {
            badge.textContent = `GPU context lost${message ? `: ${message}` : ''}`;
            badge.title = message ?? nextState?.contextMessage ?? '';
            badge.style.backgroundColor = 'rgba(140, 20, 20, 0.85)';
            badge.style.color = '#ffd0d0';
            badge.style.opacity = '1';
            return;
        }

        if (recovering) {
            badge.textContent = message ?? 'Recovering renderer…';
            badge.title = '';
            badge.style.backgroundColor = 'rgba(90, 70, 0, 0.8)';
            badge.style.color = '#ffe8a8';
            badge.style.opacity = '1';
            return;
        }

        const prLabel = nextState?.pixelRatio != null ? ` · ${nextState.pixelRatio.toFixed(2)}x` : '';
        badge.textContent = isFallback ? `renderer: ${type} (fallback)${prLabel}` : `renderer: ${type}${prLabel}`;
        badge.title = nextState?.fallbackReason ?? '';
        badge.style.backgroundColor = isFallback ? 'rgba(120, 40, 0, 0.7)' : 'rgba(0, 0, 0, 0.55)';
        badge.style.color = isFallback ? '#ffd9b0' : '#bfe8ff';
        badge.style.opacity = '1';
    }

    applyState(state);

    function scheduleFadeOut() {
        if (persistent) return;
        fadeTimers.push(setTimeout(() => { badge.style.opacity = '0'; }, 4000));
        fadeTimers.push(setTimeout(() => { badge.remove(); rendererBadge = null; }, 4800));
    }

    if (!persistent && !state?.fallbackReason && state?.contextStatus !== 'lost') {
        scheduleFadeOut();
    }

    return {
        el: badge,
        update(nextState, options) {
            for (const id of fadeTimers) clearTimeout(id);
            fadeTimers.length = 0;
            applyState(nextState, options);
        },
        remove() {
            for (const id of fadeTimers) clearTimeout(id);
            badge.remove();
            if (rendererBadge?.el === badge) rendererBadge = null;
        }
    };
}

init();

async function init() {
    // Get canvas container
    const container = document.getElementById('canvas-container');

    // Scene, camera, renderer, lights, post-processing, environment map
    const sceneSetup = await setupScene(container);
    scene = sceneSetup.scene;
    camera = sceneSetup.camera;
    renderer = sceneSetup.renderer;
    composer = sceneSetup.composer;
    rendererState = sceneSetup.rendererState;
    pointLight = sceneSetup.pointLight;
    postConfig = sceneSetup.postConfig;
    shadowController = createShadowController(renderer, scene);
    console.info(
        `[Renderer] Active backend: ${rendererState?.rendererType ?? 'webgl'}`
        + (rendererState?.fallbackReason ? ` (${rendererState.fallbackReason})` : '')
    );
    window.__renderStats = scheduler.stats;
    collisionAudio = createDiceCollisionAudio();
    rollHistory = createRollHistory();
    rollStats = createRollStats();
    if (debugEnabled) {
        renderStats = createRenderStats({
            renderer,
            scene,
            scheduler,
            cullingSystem,
            debugPerf: searchParams.has('debug-perf'),
            getRendererState: () => rendererState,
            getPost: () => postConfig,
            getShadow: () => ({
                autoUpdate: renderer.shadowMap.autoUpdate,
                staticRefreshes: shadowController?.state.staticShadowRefreshes ?? 0
            }),
            getDice: () => ({ count: spawnedDice.length, settled: areDiceSettled() }),
            getWasm: () => ({
                available: isWasmAvailable(),
                active: isWasmAvailable(),
                worker: getWorkerPhysicsStats()
            }),
            getAudio: () => collisionAudio?.getStats?.() ?? null,
            getCollisionTotal: () => collisionTotal,
            getTierRenderStats: () => tierRenderStats
        });
        // Backtick toggles the HUD during playtesting without reloading.
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote') renderStats?.toggle();
        });
        fairnessMonitor = createFairnessMonitor({ enabled: true, rollStats });
        fairnessMonitor.init();
    }
    // Surface the active renderer in-UI: persistently under ?debug/?renderer-info,
    // or as a brief auto-fading notice whenever WebGPU fell back to WebGL.
    const rendererInfoRequested = searchParams.has('renderer-info');
    const badgePersistent = debugEnabled || rendererInfoRequested;
    if (badgePersistent || rendererState?.fallbackReason) {
        rendererBadge = createRendererBadge(rendererState, { persistent: badgePersistent });
    }

    setupRendererRecovery(container);
    pixelRatioMonitor = createPixelRatioMonitor(rendererState, {
        debugPerf: searchParams.has('debug-perf'),
        onPixelRatioChange: (nextRatio) => applyLivePixelRatio(container, nextRatio)
    });
    window.addEventListener('pointerdown', () => collisionAudio?.resume(), { passive: true });
    window.addEventListener('keydown', () => collisionAudio?.resume(), { passive: true });
    // Lean into the tavern ambience while the player sits in FPS/pointer-lock mode.
    document.addEventListener('pointerlockchange', () => {
        const locked = document.pointerLockElement != null;
        collisionAudio?.setAmbientIntensity(locked ? 1.0 : 0.5);
    });

    scheduler.register('physicsStep', 'dicePhysics', ({ deltaTime }) => {
        if (!physicsWorld) return;

        const useWasm = isWasmAvailable();
        // WASM-mode interactions (?wasm-drag) are driven entirely in the WASM
        // world, so they don't force an ammo step. Ammo still steps for the
        // ammo-authoritative drag/levitation path and dual-physics validation.
        const shouldStepAmmo = !useWasm || dualPhysicsValidation || interactionNeedsAmmoStep();
        applyDiceMassBiases({
            deltaTime,
            applyAmmo: shouldStepAmmo,
            applyWasm: useWasm
        });

        if (shouldStepAmmo) {
            stepPhysics(physicsWorld, deltaTime);
        }
        if (useWasm) {
            getWasmEngine().step(deltaTime);
        }
    });

    scheduler.register('postPhysicsSync', 'diceVisualSync', () => {
        if (!physicsWorld) return;
        updateDiceVisuals();
    });

    scheduler.register('postPhysicsSync', 'collisionAudio', () => {
        if (!physicsWorld) return;
        const events = [
            ...pollPhysicsCollisionEvents(),
            ...pollAmmoCollisionEvents(physicsWorld)
        ];
        collisionTotal += events.length;
        for (const ev of events) {
            collisionAudio?.handleCollisionEvent(ev);
            if (window.__onDiceCollision) {
                window.__onDiceCollision(ev);
            }
        }
    });

    scheduler.register('updates', 'interaction', ({ deltaTime }) => {
        if (!physicsWorld) return;
        updateInteraction(deltaTime);
    }, { priority: -20 });

    scheduler.register('updates', 'atmosphere', ({ time }) => {
        updateAtmosphere(time);
    }, { priority: 10 });

    scheduler.register('preRender', 'cameraController', ({ deltaTime, time }) => {
        if (!cameraController || !inputState) return;
        cameraController.update(deltaTime, time, {
            keys: inputState.keys,
            cursorPos,
            isLocked: isLockedRef.value,
            showResults,
            hideResults,
            lampData,
            LampMode,
            onResultsReady: handleResultsReady
        });
    }, { priority: -10 });

    scheduler.register('preRender', 'diceHud', () => {
        if (!spawnedDice.length) {
            updateDiceHud([]);
            return;
        }
        const rolling = !areDiceSettled();
        updateDiceHud(readAllDiceValues(), { rolling });
    }, { priority: -5 });

    scheduler.register('preRender', 'gongFlash', () => {
        if (gongData?.getFlashIntensity) {
            gongFlashIntensity = gongData.getFlashIntensity();
        }
    });

    scheduler.register('preRender', 'candleFlicker', createCandleFlickerSystem(pointLight, () => candleFlamePos));
    scheduler.register('preRender', 'fireplaceFlicker', createFireplaceFlickerSystem(() => fireplaceLight));
    scheduler.register('preRender', 'shadowController', ({ time }) => {
        if (!shadowController) return;
        shadowController.update(time * 1000, areDiceSettled());
    });
    // Runs last in preRender (after the camera has moved this frame) so we cull
    // against the up-to-date frustum, right before sceneRender.
    scheduler.register('preRender', 'frustumCull', () => {
        cullingSystem.update(camera);
        scheduler.stats.culling = cullingSystem.stats;
    }, { priority: 100 });
    scheduler.register('preRender', 'debugStats', ({ deltaTime }) => {
        // Keep window.__renderStats populated for external/test consumers even
        // when the on-screen HUD isn't shown.
        scheduler.stats.shadow = {
            autoUpdate: renderer.shadowMap.autoUpdate,
            needsUpdate: renderer.shadowMap.needsUpdate,
            staticRefreshes: shadowController?.state.staticShadowRefreshes ?? 0,
            motionSources: shadowController?.state.externalMotionCount ?? 0
        };
        scheduler.stats.post = postConfig;
        scheduler.stats.pixelRatio = rendererState?.pixelRatio;
        pixelRatioMonitor?.update({ deltaTime });
        renderStats?.update({ deltaTime });
    });

    scheduler.register('render', 'sceneRender', () => {
        if (composer) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    });
    scheduler.register('postRender', 'workerPhysicsFlush', () => {
        flushWorkerCommandBatch();
    }, { priority: -100 });
    scheduler.register('postRender', 'renderWarnings', () => {
        if (!debugEnabled) return;
        const drawCalls = renderer.info.render.calls;
        if (drawCalls > 300) {
            console.warn(`[RenderPerf] High draw call count: ${drawCalls}`);
        }
    });

    // Start the clock and render loop immediately so the browser shows something
    // while the physics engine (WASM) compiles and initialises in the background.
    clock = new THREE.Clock();
    window.addEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(animate);

    // Initialize Physics — awaited here but the render loop above is already running,
    // so the browser paints every frame while WASM compiles/allocates.
    // Initialise WASM first so we can skip the ~300 KB gzipped ammo chunk when
    // the custom engine is authoritative (default path).
    const wasmAvailable = await loadWasmEngine();
    if (wasmAvailable) {
        const eng = getWasmEngine();
        eng.init(-15.0, -2.75, 18.0, 18.0);
        console.log('[WasmPhysics] Engine initialized and ready.');
    }

    const requireAmmo = shouldLoadAmmoPhysics(wasmAvailable);
    try {
        physicsWorld = await initPhysics({ requireAmmo });
    } catch (e) {
        console.error("Failed to initialize physics", e);
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.textContent = "Error: Physics failed to load. Check console.";
        setTimeout(() => {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.style.transition = 'opacity 0.5s';
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 500);
            }
        }, 3000);
        return;
    }

    if (wasmAvailable) {
        syncAllDiceToWasm();
    }

    // Camera controller (focus state + FPS movement)
    cameraController = createCameraController(camera);

    const rollSessionRef = { current: null };

    // Load all tiers
    let tierResult;
    try {
    tierResult = await loadTiers(scene, camera, physicsWorld, { scheduler, cullingSystem }, {
        audio: collisionAudio,
        onDiceRoll: () => {
            shadowController?.pulse('roll');
            cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
            hideResults();
            if (lampData) lampData.setRolling(true);
        },
        notationHooks: {
            onNotationRoll: async (expression) => {
                if (!rollSessionRef.current) throw new Error('Roll session not ready');
                shadowController?.pulse('roll');
                hideResults();
                cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
                if (lampData) lampData.setRolling(true);
                await rollSessionRef.current.roll(expression);
            }
        },
        setLampData: (data) => { lampData = data; },
        setGongData: (data) => { gongData = data; },
        setCandleFlamePos: (pos) => {
            candleFlamePos = pos;
            pointLight.position.copy(candleFlamePos);
            pointLight.position.y += 0.05;
        },
        setInteraction: (inter) => { interaction = inter; },
        interactionHooks: {
            onMotionActivityChange: (active, source) => {
                if (!shadowController) return;
                if (active) shadowController.noteMotionStart(source);
                else shadowController.noteMotionEnd(source);
            }
        }
    }, renderer);
    } catch (e) {
        console.error('Failed to load scene tiers', e);
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.textContent = 'Error: Scene failed to load. Check console.';
        setTimeout(() => {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.style.transition = 'opacity 0.5s';
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 500);
            }
        }, 3000);
        return;
    }

    ui = tierResult.ui;
    crosshairUI = tierResult.crosshairUI;
    tierRenderStats = tierResult.tierRenderStats ?? null;
    if (tierRenderStats) {
        window.__tierRenderStats = tierRenderStats;
    }
    if (tierResult.fireplaceLight) fireplaceLight = tierResult.fireplaceLight;
    const layoutManager = tierResult.layoutManager;

    rollSessionRef.current = createRollSession({
        scene,
        world: physicsWorld,
        replaceDiceSet,
        throwDice: (s, w, seed) => {
            throwDice(s, w, seed);
            cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
            if (lampData) lampData.setRolling(true);
        },
        readAllDiceValues,
        areDiceSettled,
        onComplete: (result) => showNotationResults(result)
    });

    // Input handling
    inputState = setupInput({
        renderer,
        camera,
        interaction,
        diceFocusStateRef: { get value() { return cameraController.getState(); }, set value(v) { cameraController.setState(v); } },
        isLockedRef,
        cursorPos,
        crosshairUI,
        onRoll: (seed = null) => beginRoll(seed),
        onRerollLayout: layoutManager ? async () => {
            const result = await layoutManager.rerollLayout({ newSeed: true });
            ui?.updateLayoutStatus?.(result);
        } : null,
        getLampData: () => lampData
    });

    rollHistoryPanel = createRollHistoryPanel({
        rollHistory,
        rollStats,
        onReplay: (seed) => beginRoll(seed)
    });

    // Expose for debugging/verification
    window.camera = camera;
    window.scene = scene;
    window.physicsWorld = physicsWorld;
    window.THREE = THREE;
    window.renderer = renderer;
    window.usingWebGPU = rendererState?.usingWebGPU === true;
    window.usingWebGL = rendererState?.usingWebGL !== false;
    window.rendererType = rendererState?.rendererType ?? 'webgl';
    window.rendererFallbackReason = rendererState?.fallbackReason ?? null;
    // WASM engine exposed after loadWasmEngine() resolves (may be the stub)
    window.getWasmEngine = getWasmEngine;
    window.isWasmAvailable = isWasmAvailable;
    window.forceShadowRefresh = () => shadowController?.forceRefresh('debug');
    window.postConfig = postConfig;
    window.fairnessMonitor = fairnessMonitor;
    window.rollHistory = rollHistory;
    window.rollStats = rollStats;
    window.resetFairnessMonitor = () => {
        rollStats?.reset();
        fairnessMonitor?.render();
        rollHistoryPanel?.refresh();
    };
    window.replayRoll = (seed) => beginRoll(seed);
    window.readAllDiceValues = readAllDiceValues;
    window.getDiceValueDebugSnapshot = getDiceValueDebugSnapshot;
    window.areDiceSettled = areDiceSettled;
    window.rollNotation = (expression, seed = null) => rollSessionRef.current?.roll(expression, seed);
    window.rerollTableLayout = (overrides) => layoutManager?.rerollLayout(overrides);
    window.getTableLayoutConfig = () => layoutManager?.getConfig();
}

function applyLivePixelRatio(container, nextRatio) {
    if (!renderer || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    applyRendererSize(renderer, width, height, nextRatio);
    rendererState.pixelRatio = nextRatio;
    rendererState.usePostAA = !rendererState.antialias && nextRatio > 1;
    if (postConfig) {
        postConfig.fxaaEnabled = rendererState.usePostAA && postConfig.quality !== 'off';
    }
    syncComposerPixelRatio(composer, width, height, nextRatio);
    rendererBadge?.update(rendererState);
}

function setupRendererRecovery(container) {
    if (rendererRecoveryCleanup) {
        rendererRecoveryCleanup();
    }

    rendererRecoveryCleanup = installRendererRecoveryHandlers(rendererState, {
        onContextLost: (state, message) => {
            if (!rendererBadge) {
                rendererBadge = createRendererBadge(state, { persistent: true });
            } else {
                rendererBadge.update(state, { status: 'lost', message });
            }
        },
        onContextRestored: (state) => {
            rendererBadge?.update(state);
            applyLivePixelRatio(container, state.pixelRatio);
        },
        onDeviceLost: async (state, info) => {
            const message = info?.message ?? 'GPU device lost';
            if (!rendererBadge) {
                rendererBadge = createRendererBadge(state, { persistent: true });
            } else {
                rendererBadge.update(state, { status: 'lost', message });
            }

            if (state._recovering) return;
            state._recovering = true;
            rendererBadge?.update(state, { status: 'recovering', message: 'Recovering via WebGL fallback…' });

            try {
                const oldCanvas = renderer.domElement;
                const nextState = await recoverRenderer(container, state);
                oldCanvas?.remove();

                renderer = nextState.renderer;
                rendererState = nextState;
                scene.userData.renderer = renderer;
                scene.userData.rendererState = rendererState;
                scene.userData.rendererType = rendererState.rendererType;
                window.renderer = renderer;

                container.appendChild(renderer.domElement);
                applyLivePixelRatio(container, nextState.pixelRatio);

                if (composer?.type === 'webgpu-post') {
                    composer.dispose?.();
                    composer = null;
                    postConfig.quality = 'low';
                    postConfig.fxaaEnabled = false;
                    postConfig.chromaticAberrationEnabled = false;
                }

                setupRendererRecovery(container);
                rendererBadge?.update(rendererState);
                console.warn('[Renderer] Recovered from GPU loss via WebGL fallback.');
            } catch (error) {
                console.error('[Renderer] Recovery failed:', error);
                rendererBadge?.update(rendererState, {
                    status: 'lost',
                    message: `${message} — reload page`
                });
            } finally {
                state._recovering = false;
            }
        }
    });
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (!container || !renderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const pixelRatio = rendererState?.pixelRatio ?? renderer.getPixelRatio();

    camera.aspect = 1; // Fixed 1:1 aspect ratio
    camera.updateProjectionMatrix();
    applyRendererSize(renderer, width, height, pixelRatio);
    syncComposerPixelRatio(composer, width, height, pixelRatio);
}

function animate() {
    const deltaTime = clock.getDelta();
    const time = clock.getElapsedTime();
    scheduler.runFrame({ deltaTime, time, renderer, composer, scene, camera });
}
