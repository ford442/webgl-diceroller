import * as THREE from 'three';

import { initPhysics, stepPhysics, pollAmmoCollisionEvents } from './physics.js';
import { loadWasmEngine, isWasmAvailable, getWasmEngine } from './wasm/PhysicsBridge.js';
import {
    updateDiceVisuals,
    throwDice,
    syncAllDiceToWasm,
    areDiceSettled,
    pollPhysicsCollisionEvents,
    applyDiceMassBiases,
    spawnedDice,
    readAllDiceValues
} from './dice.js';
import { showResults, hideResults, updateDiceHud } from './results.js';
import { updateInteraction, interactionNeedsAmmoStep } from './interaction.js';
import { createDiceCollisionAudio } from './audio/DiceCollisionAudio.js';
import { updateAtmosphere } from './environment/Atmosphere.js';
import { setupScene } from './core/SceneSetup.js';
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
import { createCullingSystem } from './core/CullingSystem.js';
import { createRenderStats } from './debug/RenderStats.js';

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
let rendererState;
let fairnessMonitor = null;
let collisionAudio = null;
let collisionTotal = 0; // running count of collision events, for the debug HUD

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
function createRendererBadge(state, { persistent }) {
    const container = document.getElementById('canvas-container') || document.body;
    const badge = document.createElement('div');
    const isFallback = Boolean(state?.fallbackReason);
    const type = state?.rendererType ?? 'webgl';
    badge.textContent = isFallback ? `renderer: ${type} (fallback)` : `renderer: ${type}`;
    badge.title = state?.fallbackReason ?? '';
    badge.style.position = 'absolute';
    badge.style.bottom = '10px';
    badge.style.left = '10px';
    badge.style.backgroundColor = isFallback ? 'rgba(120, 40, 0, 0.7)' : 'rgba(0, 0, 0, 0.55)';
    badge.style.color = isFallback ? '#ffd9b0' : '#bfe8ff';
    badge.style.fontFamily = 'monospace';
    badge.style.fontSize = '11px';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '5px';
    badge.style.zIndex = '1100';
    badge.style.pointerEvents = 'none';
    badge.style.transition = 'opacity 0.6s ease';
    container.appendChild(badge);

    // Persistent under ?debug/?renderer-info; otherwise (fallback notice) fade out.
    if (!persistent) {
        setTimeout(() => { badge.style.opacity = '0'; }, 4000);
        setTimeout(() => { badge.remove(); }, 4800);
    }
    return badge;
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
            getWasm: () => ({ available: isWasmAvailable(), active: isWasmAvailable() }),
            getAudio: () => collisionAudio?.getStats?.() ?? null,
            getCollisionTotal: () => collisionTotal
        });
        // Backtick toggles the HUD during playtesting without reloading.
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote') renderStats?.toggle();
        });
        fairnessMonitor = createFairnessMonitor({ enabled: true });
        fairnessMonitor.init();
    }
    // Surface the active renderer in-UI: persistently under ?debug/?renderer-info,
    // or as a brief auto-fading notice whenever WebGPU fell back to WebGL.
    const rendererInfoRequested = searchParams.has('renderer-info');
    if (debugEnabled || rendererInfoRequested || rendererState?.fallbackReason) {
        createRendererBadge(rendererState, { persistent: debugEnabled || rendererInfoRequested });
    }
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
            onResultsReady: (results) => fairnessMonitor?.recordResults(results)
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
        renderStats?.update({ deltaTime });
    });

    scheduler.register('render', 'sceneRender', () => {
        if (composer) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    });
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
    try {
        physicsWorld = await initPhysics();
    } catch (e) {
        console.error("Failed to initialize physics", e);
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.textContent = "Error: Physics failed to load. Check console.";
        // Fade out overlay after a short delay so the user isn't stuck on a blank screen
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

    // Load WASM physics engine in parallel (non-blocking — falls back to a
    // no-op stub when the binary is not yet compiled).
    loadWasmEngine().then((available) => {
        if (available) {
            const eng = getWasmEngine();
            eng.init(-15.0, -2.75, 18.0, 18.0);
            syncAllDiceToWasm();
            console.log('[WasmPhysics] Engine initialized and ready.');
        }
    });

    // Camera controller (focus state + FPS movement)
    cameraController = createCameraController(camera);

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
    if (tierResult.fireplaceLight) fireplaceLight = tierResult.fireplaceLight;
    const layoutManager = tierResult.layoutManager;

    // Input handling
    inputState = setupInput({
        renderer,
        camera,
        interaction,
        diceFocusStateRef: { get value() { return cameraController.getState(); }, set value(v) { cameraController.setState(v); } },
        isLockedRef,
        cursorPos,
        crosshairUI,
        onRoll: (seed = null) => {
            shadowController?.pulse('roll');
            throwDice(scene, physicsWorld, seed);
            cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
            hideResults();
            if (lampData) lampData.setRolling(true);
        },
        onRerollLayout: layoutManager ? async () => {
            const result = await layoutManager.rerollLayout({ newSeed: true });
            ui?.updateLayoutStatus?.(result);
        } : null,
        getLampData: () => lampData
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
    window.resetFairnessMonitor = () => fairnessMonitor?.reset();
    window.replayRoll = (seed) => {
        shadowController?.pulse('roll');
        throwDice(scene, physicsWorld, seed);
        cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
        hideResults();
        if (lampData) lampData.setRolling(true);
    };
    window.readAllDiceValues = readAllDiceValues;
    window.areDiceSettled = areDiceSettled;
    window.rerollTableLayout = (overrides) => layoutManager?.rerollLayout(overrides);
    window.getTableLayoutConfig = () => layoutManager?.getConfig();
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    camera.aspect = 1; // Fixed 1:1 aspect ratio
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (composer) composer.setSize(width, height);
}

function animate() {
    const deltaTime = clock.getDelta();
    const time = clock.getElapsedTime();
    scheduler.runFrame({ deltaTime, time, renderer, composer, scene, camera });
}
