import * as THREE from 'three';

import {
    initPhysics,
    stepPhysics,
    pollAmmoCollisionEvents,
    shouldLoadAmmoPhysics,
} from './physics.js';
import * as physicsSession from './physics.js';
import {
    loadWasmEngine,
    isWasmAvailable,
    getWasmEngine,
    flushWorkerCommandBatch,
    getWorkerPhysicsStats,
    getPhysicsStepStats,
} from './wasm/PhysicsBridge.js';
import {
    updateDiceVisuals,
    throwDice,
    syncAllDiceToWasm,
    areDiceSettled,
    pollPhysicsCollisionEvents,
    enrichCollisionEventForAudio,
    applyDiceMassBiases,
    spawnedDice,
    readAllDiceValues,
    getDiceValueDebugSnapshot,
    replaceDiceSet,
    updateDiceSet,
    getSpawnedDiceCounts,
    getDiceAppearanceConfig,
    buildDicePresencePayload,
    applyDicePresencePayload,
    refreshDiceAppearance,
    setDiceAppearanceQualityProfile,
} from './dice.js';
import { setAmmoDiceBackend } from './dice/DiceState.js';
import { updateInteraction, isDragging, hasActiveDiceInteraction } from './interaction.js';
import {
    createDiceCupController,
    registerDiceCupController,
    getDiceCupController,
} from './interaction/DiceCupController.js';
import { setInteractablesMirror } from './interactables/InteractableRegistry.js';
import { isXrRequested } from './xr/XrFlags.js';
import { createDiceCollisionAudio } from './audio/DiceCollisionAudio.js';
import { updateAtmosphere } from './environment/Atmosphere.js';
import { setupScene } from './core/SceneSetup.js';
import { createAppContext } from './core/AppContext.js';
import { createAppEvents, AppEvent } from './core/AppEvents.js';
import { installAppTestHooks } from './core/AppTestHooks.js';
import {
    applyRendererSize,
    createPixelRatioMonitor,
    installRendererRecoveryHandlers,
    recoverRenderer,
    syncComposerPixelRatio,
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
    PROP_INDEX,
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
import { createRollSession, shouldDeferAutoResults } from './roll/RollSession.js';
import {
    ROLL_SYSTEMS,
    DEFAULT_ROLL_SYSTEM,
    applyExpressionChip,
    defaultExpressionForSystem,
} from './roll/Notation.js';
import { applyViewportToCamera } from './core/SceneMetrics.js';
import { bootstrapAdaptiveQuality, updateAdaptiveQualityProbe } from './core/AdaptiveQuality.js';
import { isTouchPrimaryDevice } from './core/DeviceCapabilities.js';
import { createDiceGameFeelSystem } from './effects/DiceGameFeel.js';
import {
    REPLAY_VERSION,
    buildShareableRollUrl,
    generateRollSeed,
    parseShareableRollParams,
} from './roll/ShareableRoll.js';
import { showResults, hideResults, showNotationResults, updateDiceHud } from './results.js';
import { createRoomSession, resolveSignalingUrl } from './net/RoomSession.js';
import { createMultiplayerPanel } from './ui/MultiplayerPanel.js';

/** @typedef {import('./types/app').ComposerLike} ComposerLike */
/** @typedef {import('./types/app').PostConfig} PostConfig */
/** @typedef {import('./types/app').RendererState} RendererState */
/** @typedef {import('./types/app').PendingRollMeta} PendingRollMeta */
/** @typedef {import('./types/ammo').AmmoWorld} AmmoWorld */

/** @type {import('three').PerspectiveCamera | undefined} */
let camera;
/** @type {import('three').Scene | undefined} */
let scene;
/** @type {import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer | undefined} */
let renderer;
/** @type {ComposerLike | null | undefined} */
let composer;
/** @type {AmmoWorld | null | undefined} */
let physicsWorld;
/** @type {import('three').Clock | undefined} */
let clock;
/** @type {ReturnType<typeof import('./ui.js').initUI> | null | undefined} */
let ui;
/** @type {ReturnType<typeof import('./ui.js').createCrosshair> | null | undefined} */
let crosshairUI;
/** @type {import('three').PointLight | undefined} */
let pointLight;
/** @type {import('three').SpotLight | undefined} */
let spotLight;
/** @type {import('three').PointLight | undefined} */
let fireplaceLight;
/** @type {import('three').Vector3 | undefined} */
let candleFlamePos;
/** @type {{ setRolling?: (rolling: boolean) => void } | null | undefined} */
let lampData;
/** @type {{ getFlashIntensity?: () => number } | null | undefined} */
let gongData;
let _gongFlashIntensity = 0;
/** @type {ReturnType<typeof import('./interaction.js').initInteraction> | undefined} */
let interaction;
const searchParams = new URLSearchParams(window.location.search);
const debugEnabled = searchParams.has('debug') || searchParams.has('debug-perf');
const testHooksEnabled = searchParams.has('test') || debugEnabled;
const scheduler = createFrameScheduler({
    fixedDeltaTime: 1 / 60,
    maxPhysicsSteps: 5,
    debugPerf: searchParams.has('debug-perf'),
});
const cullingSystem = createCullingSystem({ enabled: !searchParams.has('no-cull') });

const appEvents = createAppEvents();
const app = createAppContext({ events: appEvents });
app.scheduler = scheduler;
app.THREE = THREE;
app.stats = scheduler.stats;
app.isTouchPrimaryDevice = isTouchPrimaryDevice();
setInteractablesMirror(app.interactables);

const propRegistryApi = {
    getPropsByTag,
    getPropsByCategory,
    getPropDescriptor,
    getRandomProps,
    getClutterPool,
    getAllTags,
    getAllCategories,
    selectDecorPoolEntries,
    PROP_INDEX,
};
app.PropRegistry = propRegistryApi;

if (testHooksEnabled) {
    installAppTestHooks(app);
}
let postConfig;
/** @type {import('./types/app').AdaptiveQualityState | null} */
let adaptiveQualityState = null;
/** @type {ReturnType<typeof createShadowController> | null} */
let shadowController;
let renderStats = null;
let tierRenderStats = null;
/** @type {RendererState | undefined} */
let rendererState;
/** @type {{ el: HTMLElement; update(nextState: unknown, options?: unknown): void; remove(): void } | null} */
let rendererBadge = null;

function getRendererBadgeApi() {
    return /** @type {{ update(nextState: unknown, options?: unknown): void; remove(): void } | null} */ (
        rendererBadge
    );
}
/** @type {ReturnType<typeof import('./core/RendererFactory.js').createPixelRatioMonitor> | null} */
let pixelRatioMonitor = null;
/** @type {(() => void) | null} */
let rendererRecoveryCleanup = null;
let fairnessMonitor = null;
let rollHistory = null;
let rollStats = null;
let rollHistoryPanel = null;
/** @type {PendingRollMeta} */
let pendingRollMeta = {
    seed: null,
    expression: null,
    diceSet: /** @type {Record<string, number>} */ ({}),
};
let collisionAudio = null;
let collisionTotal = 0;
let diceGameFeel = null;
let diceCupController = null;
/** @type {{ roll: ((seed?: number | null) => number | void) | null; lastRoll: { seed?: number; counts?: Record<string, number>; source?: string } | null }} */
const rollHandlerRef = { roll: null, lastRoll: null };
/** @type {{ current: ReturnType<typeof createRoomSession> | null }} */
const multiplayerRef = { current: null };

function isSimulationReady() {
    return isWasmAvailable() || physicsWorld != null;
}

function showCupFeedback(message) {
    const el = document.getElementById('loading-text');
    if (!el) return;
    const prev = el.textContent;
    el.textContent = message;
    el.style.opacity = '1';
    setTimeout(() => {
        if (el.textContent === message) el.textContent = prev;
    }, 1800);
}

function captureDiceSet() {
    /** @type {Record<string, number>} */
    const diceSet = {};
    spawnedDice.forEach((die) => {
        diceSet[die.type] = (diceSet[die.type] ?? 0) + 1;
    });
    return diceSet;
}

function emitRollStarted(extra = {}) {
    appEvents.emit(AppEvent.ROLL_STARTED, {
        seed: pendingRollMeta.seed,
        expression: pendingRollMeta.expression,
        diceSet: pendingRollMeta.diceSet,
        source: pendingRollMeta.source,
        ...extra,
    });
}

function beginCupRoll() {
    pendingRollMeta = {
        seed: null,
        expression: null,
        diceSet: captureDiceSet(),
        source: 'cup',
    };
    rollHandlerRef.lastRoll = {
        seed: null,
        counts: getSpawnedDiceCounts(),
        source: 'cup',
    };
    shadowController?.pulse('roll');
    diceGameFeel?.clearRollState();
    cameraController?.setState(DiceFocusState.WAITING_FOR_STOP);
    hideResults();
    if (lampData) lampData.setRolling(true);
    emitRollStarted({ source: 'cup' });
}

function beginRoll(seed = null, expression = null) {
    pendingRollMeta = {
        seed: seed ?? null,
        expression: expression ?? null,
        diceSet: captureDiceSet(),
    };
    shadowController?.pulse('roll');
    diceGameFeel?.clearRollState();
    throwDice(scene, physicsWorld, seed);
    cameraController?.setState(DiceFocusState.WAITING_FOR_STOP);
    hideResults();
    if (lampData) lampData.setRolling(true);
    emitRollStarted();
}

function handleResultsReady(results) {
    rollHistory?.appendRoll(results, pendingRollMeta);
    rollStats?.recordResults(results);
    fairnessMonitor?.render();
    rollHistoryPanel?.refresh();
    diceGameFeel?.onResultsReady(results);
    multiplayerRef.current?.recordSettledResults?.(results);
    pendingRollMeta = {
        seed: null,
        expression: null,
        diceSet: /** @type {Record<string, number>} */ ({}),
    };
}

function bindRollSettledSubscribers() {
    appEvents.on(AppEvent.ROLL_SETTLED, (payload) => {
        const results = /** @type {{ results?: unknown }} */ (payload)?.results ?? payload;
        if (!shouldDeferAutoResults()) {
            showResults(/** @type {import('./types/dice').DiceReadValue[]} */ (results));
        }
        handleResultsReady(/** @type {import('./types/dice').DiceReadValue[]} */ (results));
    });
}

function bindCollisionSubscribers() {
    appEvents.on(AppEvent.DICE_COLLISION, (ev) => {
        collisionAudio?.handleCollisionEvent(ev);
        collisionAudio?.checkCollisionPropReactions?.(ev);
        diceGameFeel?.handleCollisionEvent(ev);
    });
}

// "Eye-Head" Cursor Logic
const cursorPos = new THREE.Vector2(0, 0); // Pixel coordinates relative to center
const isLockedRef = { value: false };
/** @type {{ value: boolean }} */
const isXrPresentingRef = { value: false };
/** @type {Awaited<ReturnType<typeof import('./xr/XrSession.js').initXrSession>>} */
let xrSessionApi = null;

let cameraController;
/** @type {ReturnType<typeof import('./core/InputHandler.js').setupInput> | undefined} */
let inputState;

function createShadowController(rendererRef, sceneRef) {
    const state = {
        externalMotionCount: 0,
        settleStartedAtMs: null,
        staticShadowRefreshes: 0,
        lastReason: 'startup',
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

            if (timeMs - state.settleStartedAtMs >= 500 && rendererRef.shadowMap.autoUpdate) {
                requestStaticRefresh('settled');
            }
        },
    };
}

// Small, unobtrusive indicator of the active renderer. Shown when ?debug is on,
// when ?renderer-info is requested, or whenever WebGPU fell back to WebGL so the
// user understands they're on the degraded baseline path. In the happy WebGPU
// case (no debug) nothing is shown, keeping the UI clean.
/**
 * @param {import('./types/app').RendererState | undefined} state
 * @param {{ persistent?: boolean }} [options]
 */
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

    function applyState(
        nextState,
        /** @type {{ status?: string; message?: string }} */ options = {}
    ) {
        const { status, message } = options;
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

        const prLabel =
            nextState?.pixelRatio != null ? ` · ${nextState.pixelRatio.toFixed(2)}x` : '';
        badge.textContent = isFallback
            ? `renderer: ${type} (fallback)${prLabel}`
            : `renderer: ${type}${prLabel}`;
        badge.title = nextState?.fallbackReason ?? '';
        badge.style.backgroundColor = isFallback ? 'rgba(120, 40, 0, 0.7)' : 'rgba(0, 0, 0, 0.55)';
        badge.style.color = isFallback ? '#ffd9b0' : '#bfe8ff';
        badge.style.opacity = '1';
    }

    applyState(state);

    function scheduleFadeOut() {
        if (persistent) return;
        fadeTimers.push(
            setTimeout(() => {
                badge.style.opacity = '0';
            }, 4000)
        );
        fadeTimers.push(
            setTimeout(() => {
                badge.remove();
                rendererBadge = null;
            }, 4800)
        );
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
        },
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
    spotLight = sceneSetup.spotLight;
    shadowController = createShadowController(renderer, scene);
    console.info(
        `[Renderer] Active backend: ${rendererState?.rendererType ?? 'webgl'}` +
            (rendererState?.fallbackReason ? ` (${rendererState.fallbackReason})` : '')
    );

    app.scene = scene;
    app.camera = camera;
    app.renderer = renderer;
    app.postConfig = postConfig;
    app.rendererType = rendererState?.rendererType ?? 'webgl';
    app.usingWebGPU = rendererState?.usingWebGPU === true;
    app.usingWebGL = rendererState?.usingWebGL !== false;
    app.rendererFallbackReason = rendererState?.fallbackReason ?? null;
    app.stats = scheduler.stats;

    collisionAudio = createDiceCollisionAudio();
    app.audio = collisionAudio;
    diceGameFeel = createDiceGameFeelSystem(scene, { postConfig, rendererState });
    rollHistory = createRollHistory();
    rollStats = createRollStats();
    app.rollHistory = rollHistory;
    app.rollStats = rollStats;
    bindCollisionSubscribers();
    bindRollSettledSubscribers();
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
                autoUpdate:
                    'autoUpdate' in renderer.shadowMap
                        ? /** @type {import('three').WebGLShadowMap} */ (renderer.shadowMap)
                              .autoUpdate
                        : false,
                staticRefreshes: shadowController?.state.staticShadowRefreshes ?? 0,
            }),
            getDice: () => ({ count: spawnedDice.length, settled: areDiceSettled() }),
            getWasm: () => ({
                available: isWasmAvailable(),
                active: isWasmAvailable(),
                worker: getWorkerPhysicsStats(),
                stepStats: getPhysicsStepStats(),
            }),
            getAudio: () => collisionAudio?.getStats?.() ?? null,
            getCollisionTotal: () => collisionTotal,
            getTierRenderStats: () => tierRenderStats,
        });
        // Backtick toggles the HUD during playtesting without reloading.
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote') renderStats?.toggle();
        });
        fairnessMonitor = createFairnessMonitor({ enabled: true, rollStats });
        fairnessMonitor.init();
        app.fairnessMonitor = fairnessMonitor;
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
        onPixelRatioChange: (nextRatio) => applyLivePixelRatio(container, nextRatio),
    });

    const adaptiveBootstrap = bootstrapAdaptiveQuality({
        scene,
        renderer,
        postConfig,
        composer,
        spotLight,
        rendererState,
        scheduler,
    });
    adaptiveQualityState = {
        probe: adaptiveBootstrap.probe,
        initialProfile: adaptiveBootstrap.initialProfile,
        appliedProfile: adaptiveBootstrap.initialProfile,
        scene,
        renderer,
        postConfig,
        composer,
        spotLight,
        rendererState,
    };
    app.qualityProfile = postConfig.adaptiveProfile;
    setDiceAppearanceQualityProfile(postConfig.adaptiveProfile);
    window.addEventListener('pointerdown', () => collisionAudio?.resume(), { passive: true });
    window.addEventListener('keydown', () => collisionAudio?.resume(), { passive: true });
    // Lean into the tavern ambience while the player sits in FPS/pointer-lock mode.
    document.addEventListener('pointerlockchange', () => {
        const locked = document.pointerLockElement != null;
        collisionAudio?.setAmbientIntensity(locked ? 1.0 : 0.5);
    });

    scheduler.register('physicsStep', 'dicePhysics', ({ deltaTime }) => {
        if (!isSimulationReady()) return;

        const useWasm = isWasmAvailable();

        // Dice run on WASM whenever it is live; ammo steps only on the
        // `?no-wasm` fallback, where physicsWorld is the sole dice simulation.
        const shouldStepAmmo = Boolean(physicsWorld) && !useWasm;
        applyDiceMassBiases({
            deltaTime,
            applyAmmo: shouldStepAmmo,
            applyWasm: useWasm,
        });

        if (shouldStepAmmo) {
            stepPhysics(physicsWorld, deltaTime);
        }
        if (useWasm) {
            getWasmEngine().step(deltaTime);
        }
    });

    scheduler.register('postPhysicsSync', 'diceVisualSync', () => {
        if (!isSimulationReady()) return;
        updateDiceVisuals();
    });

    scheduler.register('postPhysicsSync', 'collisionAudio', () => {
        if (!isSimulationReady()) return;

        const events = [...pollPhysicsCollisionEvents()];
        if (physicsWorld) {
            events.push(...pollAmmoCollisionEvents(physicsWorld));
        }
        collisionTotal += events.length;
        for (const ev of events) {
            const audioEv = enrichCollisionEventForAudio(ev);
            appEvents.emit(AppEvent.DICE_COLLISION, audioEv);
        }
    });

    scheduler.register(
        'preStep',
        'diceCup',
        ({ deltaTime }) => {
            diceCupController?.update(deltaTime);
        },
        { priority: -15 }
    );

    scheduler.register(
        'updates',
        'interaction',
        ({ deltaTime }) => {
            if (!isSimulationReady()) return;
            updateInteraction(deltaTime);
        },
        { priority: -20 }
    );

    scheduler.register(
        'updates',
        'atmosphere',
        ({ time }) => {
            updateAtmosphere(time);
        },
        { priority: 10 }
    );

    scheduler.register(
        'preRender',
        'audioListener',
        () => {
            collisionAudio?.updateListener?.(camera);
        },
        { priority: 100 }
    );

    scheduler.register(
        'preRender',
        'cameraController',
        ({ deltaTime, time }) => {
            if (!cameraController || !inputState) return;
            cameraController.update(deltaTime, time, {
                keys: inputState.keys,
                cursorPos,
                isLocked: isLockedRef.value,
                hideResults,
                lampData,
                LampMode,
                onSettled: (results) => {
                    appEvents.emit(AppEvent.ROLL_SETTLED, { results });
                },
                touchPrimary: inputState?.touchPrimary === true,
                xrPresenting: isXrPresentingRef.value,
            });
        },
        { priority: -10 }
    );

    scheduler.register(
        'preRender',
        'diceHud',
        () => {
            if (!spawnedDice.length) {
                updateDiceHud([]);
                return;
            }
            const rolling = !areDiceSettled();
            updateDiceHud(readAllDiceValues(), { rolling });
        },
        { priority: -5 }
    );

    scheduler.register(
        'preRender',
        'diceGameFeel',
        ({ deltaTime }) => {
            if (!diceGameFeel) return;
            scheduler.stats.gameFeel = diceGameFeel.update(deltaTime);
        },
        { priority: 95 }
    );

    scheduler.register('preRender', 'gongFlash', () => {
        if (gongData?.getFlashIntensity) {
            _gongFlashIntensity = gongData.getFlashIntensity();
        }
    });

    scheduler.register(
        'preRender',
        'candleFlicker',
        createCandleFlickerSystem(pointLight, () => candleFlamePos)
    );
    scheduler.register(
        'preRender',
        'fireplaceFlicker',
        createFireplaceFlickerSystem(() => fireplaceLight)
    );
    scheduler.register('preRender', 'shadowController', ({ time }) => {
        if (!shadowController) return;
        shadowController.update(time * 1000, areDiceSettled());
    });
    // Runs last in preRender (after the camera has moved this frame) so we cull
    // against the up-to-date frustum, right before sceneRender.
    scheduler.register(
        'preRender',
        'frustumCull',
        () => {
            cullingSystem.update(camera);
            scheduler.stats.culling = cullingSystem.stats;
        },
        { priority: 100 }
    );
    scheduler.register('preRender', 'debugStats', ({ deltaTime, time }) => {
        // Keep app.stats (and window.__renderStats under test hooks) populated.
        scheduler.stats.shadow = {
            autoUpdate: /** @type {{ autoUpdate?: boolean; needsUpdate?: boolean }} */ (
                renderer.shadowMap
            ).autoUpdate,
            needsUpdate: /** @type {{ autoUpdate?: boolean; needsUpdate?: boolean }} */ (
                renderer.shadowMap
            ).needsUpdate,
            staticRefreshes: shadowController?.state.staticShadowRefreshes ?? 0,
            motionSources: shadowController?.state.externalMotionCount ?? 0,
        };
        scheduler.stats.post = postConfig;
        scheduler.stats.pixelRatio = rendererState?.pixelRatio;
        pixelRatioMonitor?.update({ deltaTime });
        if (adaptiveQualityState?.probe) {
            updateAdaptiveQualityProbe(adaptiveQualityState.probe, { time }, adaptiveQualityState);
            if (/** @type {{ done?: boolean }} */ (adaptiveQualityState.probe).done) {
                app.qualityProfile = postConfig.adaptiveProfile;
                setDiceAppearanceQualityProfile(postConfig.adaptiveProfile);
                adaptiveQualityState.probe = null;
            }
        }
        renderStats?.update({ deltaTime });
    });

    scheduler.register('render', 'sceneRender', () => {
        // EffectComposer is incompatible with the XR framebuffer — always use
        // the raw renderer while presenting (and ?xr already disables composer).
        if (isXrPresentingRef.value || renderer.xr?.isPresenting) {
            renderer.render(scene, camera);
        } else if (composer?.render) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    });
    scheduler.register(
        'postRender',
        'workerPhysicsFlush',
        () => {
            flushWorkerCommandBatch();
        },
        { priority: -100 }
    );
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
    app.physics.getWasmEngine = getWasmEngine;
    app.physics.isWasmAvailable = isWasmAvailable;
    if (wasmAvailable) {
        const eng = getWasmEngine();
        eng.init(-15.0, -2.75, 18.0, 18.0);
        console.log('[WasmPhysics] Engine initialized and ready.');
    }

    const requireAmmo = shouldLoadAmmoPhysics(wasmAvailable);
    try {
        physicsWorld = await initPhysics({ requireAmmo });
        app.physicsWorld = physicsWorld;
        app.physics.world = physicsWorld;
        app.physics.getWasmEngine = getWasmEngine;
        app.physics.isWasmAvailable = isWasmAvailable;
        if (requireAmmo) {
            const backend = await import('./dice/AmmoDiceBackend.js');
            backend.bindPhysicsModule(physicsSession);
            setAmmoDiceBackend(backend);
        }
    } catch (e) {
        console.error('Failed to initialize physics', e);
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.textContent = 'Error: Physics failed to load. Check console.';
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
    let activeRollSystem = DEFAULT_ROLL_SYSTEM;

    // Load all tiers
    let tierResult;
    try {
        tierResult = await loadTiers(
            scene,
            camera,
            physicsWorld,
            { scheduler, cullingSystem },
            {
                app,
                audio: collisionAudio,
                qualityProfile: postConfig?.adaptiveProfile ?? app.qualityProfile ?? null,
                onRollAll: () => {
                    if (multiplayerRef.current?.isGuest()) return;
                    rollHandlerRef.roll?.();
                },
                rollShareHooks: {
                    hasShareableRoll: () => rollHandlerRef.lastRoll?.seed != null,
                    buildShareUrl: () => {
                        const last = rollHandlerRef.lastRoll;
                        if (!last?.seed) return null;
                        return buildShareableRollUrl(
                            last.seed,
                            last.counts,
                            undefined,
                            getDiceAppearanceConfig(),
                            {
                                expression: last.expression ?? null,
                                system: last.system ?? null,
                            }
                        );
                    },
                },
                notationHooks: {
                    systems: Object.values(ROLL_SYSTEMS).map((s) => ({ id: s.id, label: s.label })),
                    getSystem: () => activeRollSystem,
                    setSystem: (id) => {
                        if (ROLL_SYSTEMS[id]) activeRollSystem = id;
                    },
                    applyChip: (expr, chip, system) => applyExpressionChip(expr, chip, system),
                    defaultExpressionForSystem,
                    onNotationRoll: async (expression, opts = {}) => {
                        if (multiplayerRef.current?.isGuest()) {
                            throw new Error('Only the host can roll');
                        }
                        if (!rollSessionRef.current) throw new Error('Roll session not ready');
                        const system = opts.system ?? activeRollSystem;
                        activeRollSystem = system;
                        const seed = generateRollSeed();
                        pendingRollMeta = {
                            seed,
                            expression,
                            diceSet: captureDiceSet(),
                            source: 'notation',
                        };
                        shadowController?.pulse('roll');
                        diceGameFeel?.clearRollState();
                        hideResults();
                        cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
                        if (lampData) lampData.setRolling(true);
                        emitRollStarted({ source: 'notation', expression, seed });
                        await rollSessionRef.current.roll(expression, seed, { system });
                    },
                },
                setLampData: (data) => {
                    lampData = data;
                    collisionAudio?.setLampData?.(data);
                },
                setGongData: (data) => {
                    gongData = data;
                },
                setCandleFlamePos: (pos) => {
                    candleFlamePos = pos;
                    pointLight.position.copy(candleFlamePos);
                    pointLight.position.y += 0.05;
                },
                setInteraction: (inter) => {
                    interaction = inter;
                    app.interaction = inter;
                },
                onDiceCupInteract: () => {
                    if (diceCupController?.getState().state === 'shaking') {
                        diceCupController.handlePourKey();
                    } else {
                        diceCupController?.tryGrabCup();
                    }
                },
                getDiceCupState: () =>
                    diceCupController?.getState() ?? { available: false, state: 'idle' },
                interactionHooks: {
                    onMotionActivityChange: (active, source) => {
                        if (!shadowController) return;
                        if (active) shadowController.noteMotionStart(source);
                        else shadowController.noteMotionEnd(source);
                    },
                },
            },
            renderer
        );
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
    app.ui = ui;
    crosshairUI = tierResult.crosshairUI;
    tierRenderStats = tierResult.tierRenderStats ?? null;
    app.tierRenderStats = tierRenderStats;
    if (tierResult.fireplaceLight) fireplaceLight = tierResult.fireplaceLight;
    const layoutManager = tierResult.layoutManager;

    if (tierResult.interaction) {
        interaction = tierResult.interaction;
        app.interaction = interaction;
    }

    if (tierResult.diceCupProp) {
        diceCupController = createDiceCupController({
            cupProp: tierResult.diceCupProp,
            camera,
            beginCupRoll,
            onMotionActivityChange: (active, source) => {
                if (!shadowController) return;
                if (active) shadowController.noteMotionStart(source);
                else shadowController.noteMotionEnd(source);
            },
            onFeedback: showCupFeedback,
            canStartCupInteraction: () => !isDragging() && !hasActiveDiceInteraction(),
        });
        registerDiceCupController(diceCupController);
    }

    rollSessionRef.current = createRollSession({
        scene,
        world: physicsWorld,
        replaceDiceSet,
        throwDice: (s, w, seed) => {
            if (seed != null) {
                rollHandlerRef.lastRoll = {
                    seed: seed >>> 0,
                    counts: getSpawnedDiceCounts(),
                    expression: null,
                    system: activeRollSystem,
                };
            }
            diceGameFeel?.clearRollState();
            throwDice(s, w, seed);
            cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
            if (lampData) lampData.setRolling(true);
        },
        readAllDiceValues,
        areDiceSettled,
        getSystem: () => activeRollSystem,
        onComplete: (result) => {
            if (result?.seed != null) {
                rollHandlerRef.lastRoll = {
                    seed: result.seed >>> 0,
                    counts: getSpawnedDiceCounts(),
                    expression: result.expression,
                    system: activeRollSystem,
                };
            }
            showNotationResults(result);
            diceGameFeel?.onNotationResult?.(result);
        },
    });
    app.rollSession = rollSessionRef.current;

    rollHandlerRef.roll = (explicitSeed = null) => {
        if (multiplayerRef.current?.isGuest()) return;
        const seed = explicitSeed ?? generateRollSeed();
        rollHandlerRef.lastRoll = {
            seed: seed >>> 0,
            counts: getSpawnedDiceCounts(),
        };
        pendingRollMeta = {
            seed: seed >>> 0,
            expression: null,
            diceSet: captureDiceSet(),
            source: 'ui',
        };
        shadowController?.pulse('roll');
        diceGameFeel?.clearRollState();
        throwDice(scene, physicsWorld, seed);
        cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
        hideResults();
        if (lampData) lampData.setRolling(true);
        emitRollStarted({ source: 'ui', seed: seed >>> 0 });
        return seed;
    };

    // Input handling
    inputState = setupInput({
        renderer,
        camera,
        interaction,
        cameraController,
        diceFocusStateRef: {
            get value() {
                return cameraController.getState();
            },
            set value(v) {
                cameraController.setState(v);
            },
        },
        isLockedRef,
        isXrPresenting: () => isXrPresentingRef.value,
        cursorPos,
        crosshairUI,
        onRoll: (seed = null) => rollHandlerRef.roll(seed),
        onRerollLayout: layoutManager
            ? async () => {
                  const result = await layoutManager.rerollLayout({ newSeed: true });
                  ui?.updateLayoutStatus?.(result);
                  appEvents.emit(AppEvent.LAYOUT_REROLLED, result);
              }
            : null,
        getLampData: () => lampData,
        onCupPourKey: () => getDiceCupController()?.handlePourKey(),
    });
    app.touchInputEnabled = inputState?.touchInput?.enabled === true;

    // WebXR seated-table spike — dynamic import keeps desktop bundles free of XR code.
    if (isXrRequested(searchParams)) {
        try {
            const { initXrSession } = await import('./xr/XrSession.js');
            xrSessionApi = await initXrSession({
                renderer: /** @type {import('three').WebGLRenderer} */ (renderer),
                scene,
                camera,
                hooks: {
                    onMotionActivityChange: (active, source) => {
                        if (!shadowController) return;
                        if (active) shadowController.noteMotionStart(source);
                        else shadowController.noteMotionEnd(source);
                    },
                },
                onPresentingChange: (presenting) => {
                    isXrPresentingRef.value = presenting;
                    if (presenting && document.pointerLockElement) {
                        document.exitPointerLock();
                    }
                    if (crosshairUI) crosshairUI.setVisible(false);
                },
            });
            app.xr = xrSessionApi;
            scheduler.register('updates', 'xrSession', ({ deltaTime }) => {
                xrSessionApi?.update(deltaTime);
            });
            console.info(
                '[XR] Seated-table spike ready — use Enter VR when immersive-vr is available.'
            );
        } catch (err) {
            console.warn('[XR] Failed to initialize:', err);
        }
    }

    rollHistoryPanel = createRollHistoryPanel({
        rollHistory,
        rollStats,
        onReplay: (seed) => beginRoll(seed),
    });

    // Bind stable dice / debug API onto app (window.__app under ?test/?debug).
    app.dice.replayRoll = (seed) => beginRoll(seed);
    app.dice.readAllDiceValues = readAllDiceValues;
    app.dice.areDiceSettled = areDiceSettled;
    app.dice.getDiceValueDebugSnapshot = getDiceValueDebugSnapshot;
    app.dice.rollNotation = (expression, seed = null, options = {}) =>
        rollSessionRef.current?.roll(expression, seed, options);
    // Top-level aliases documented for Playwright.
    app.replayRoll = app.dice.replayRoll;
    app.readAllDiceValues = readAllDiceValues;
    app.areDiceSettled = areDiceSettled;
    app.isWasmAvailable = isWasmAvailable;
    app.getWasmEngine = getWasmEngine;
    app.forceShadowRefresh = () => shadowController?.forceRefresh('debug');
    app.resetFairnessMonitor = () => {
        rollStats?.reset();
        fairnessMonitor?.render();
        rollHistoryPanel?.refresh();
    };
    app.rerollTableLayout = (overrides) => {
        const p = layoutManager?.rerollLayout(overrides);
        return Promise.resolve(p).then((result) => {
            if (result) appEvents.emit(AppEvent.LAYOUT_REROLLED, result);
            return result;
        });
    };
    app.getTableLayoutConfig = () => layoutManager?.getConfig();
    app.getLastRollShareUrl = () => {
        const last = rollHandlerRef.lastRoll;
        if (!last?.seed) return null;
        return buildShareableRollUrl(last.seed, last.counts, undefined, getDiceAppearanceConfig(), {
            expression: last.expression ?? null,
            system: last.system ?? null,
        });
    };
    app.getDiceAppearanceConfig = getDiceAppearanceConfig;
    app.getDicePresencePayload = () => buildDicePresencePayload(getDiceAppearanceConfig());
    app.applyDicePresencePayload = applyDicePresencePayload;
    app.refreshDiceAppearance = () => {
        refreshDiceAppearance();
        multiplayerRef.current?.broadcastPresence?.();
    };
    app.REPLAY_VERSION = REPLAY_VERSION;

    const signalingUrl = resolveSignalingUrl(searchParams);
    const roomParam = searchParams.get('room');
    if (signalingUrl) {
        const session = createRoomSession({
            signalingUrl,
            events: appEvents,
            getDiceCounts: () => getSpawnedDiceCounts(),
            getPresencePayload: () => buildDicePresencePayload(getDiceAppearanceConfig()),
            applyPresencePayload: (payload) => {
                applyDicePresencePayload(payload);
            },
            isWasmAvailable,
            onRemoteRoll: async ({ seed, notation, diceCounts }) => {
                if (diceCounts) {
                    updateDiceSet(scene, physicsWorld, diceCounts);
                    ui?.updateCounts?.(diceCounts);
                }
                pendingRollMeta = {
                    seed: seed >>> 0,
                    expression: notation,
                    diceSet: diceCounts ?? captureDiceSet(),
                    source: 'remote',
                };
                hideResults();
                shadowController?.pulse('roll');
                diceGameFeel?.clearRollState();
                if (lampData) lampData.setRolling(true);
                cameraController?.setState(DiceFocusState.WAITING_FOR_STOP);
                if (notation && rollSessionRef.current) {
                    await rollSessionRef.current.roll(notation, seed);
                } else {
                    beginRoll(seed, notation);
                }
            },
            onRemoteTableSync: async (msg) => {
                if (msg.diceCounts) {
                    updateDiceSet(scene, physicsWorld, msg.diceCounts);
                    ui?.updateCounts?.(msg.diceCounts);
                }
                const last = msg.lastRoll;
                if (last?.seed != null && isWasmAvailable()) {
                    if (last.notation && rollSessionRef.current) {
                        pendingRollMeta = {
                            seed: last.seed >>> 0,
                            expression: last.notation,
                            diceSet: last.diceCounts ?? captureDiceSet(),
                            source: 'remote-sync',
                        };
                        await rollSessionRef.current.roll(last.notation, last.seed);
                    } else if (last.diceCounts) {
                        updateDiceSet(scene, physicsWorld, last.diceCounts);
                        beginRoll(last.seed);
                    } else {
                        beginRoll(last.seed);
                    }
                }
            },
        });
        multiplayerRef.current = session;
        app.multiplayer = session;

        const panelParent = document.getElementById('dice-controls-panel');
        if (panelParent) {
            const mpPanel = createMultiplayerPanel({
                parent: panelParent,
                touchUi: isTouchPrimaryDevice(),
                onCreate: () => session.createAndHost(),
                onJoin: (code) => session.joinRoom(code),
                onLeave: () => session.leave(),
            });
            session.onStatus((state) => mpPanel.updateStatus(state));
            if (roomParam) {
                mpPanel.setJoinCode(roomParam);
                session.joinRoom(roomParam).catch((err) => {
                    console.warn('[Multiplayer] auto-join failed', err);
                });
            }
        } else if (roomParam) {
            session.joinRoom(roomParam).catch((err) => {
                console.warn('[Multiplayer] auto-join failed', err);
            });
        }
    }

    // Room deep-link wins over one-shot shareable seed replay.
    const replayRequest = roomParam ? null : parseShareableRollParams(searchParams);
    if (replayRequest) {
        if ('error' in replayRequest && replayRequest.error === 'unsupported_version') {
            console.warn(
                `[ShareableRoll] Unsupported replay version v=${replayRequest.version} (need v=${REPLAY_VERSION}); skipping auto-replay.`
            );
        } else {
            if (!isWasmAvailable()) {
                console.warn(
                    '[ShareableRoll] WASM physics is not available; replay uses ammo fallback and may not match the original roll. Run `npm run build:wasm` for bit-identical replay.'
                );
            }
            if ('diceCounts' in replayRequest && replayRequest.diceCounts) {
                updateDiceSet(scene, physicsWorld, replayRequest.diceCounts);
                ui?.updateCounts?.(replayRequest.diceCounts);
            }
            if (replayRequest.system && ROLL_SYSTEMS[replayRequest.system]) {
                activeRollSystem = replayRequest.system;
            }
            if (replayRequest.expression) {
                rollHandlerRef.lastRoll = {
                    seed: replayRequest.seed >>> 0,
                    counts: {},
                    expression: replayRequest.expression,
                    system: activeRollSystem,
                };
                rollSessionRef.current
                    ?.roll(replayRequest.expression, replayRequest.seed, {
                        system: activeRollSystem,
                    })
                    ?.catch((err) => console.warn('[ShareableRoll] expression replay failed', err));
            } else {
                rollHandlerRef.roll(replayRequest.seed);
            }
        }
    }
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
    getRendererBadgeApi()?.update(rendererState);
}

function setupRendererRecovery(container) {
    if (rendererRecoveryCleanup) {
        rendererRecoveryCleanup();
    }

    rendererRecoveryCleanup = installRendererRecoveryHandlers(rendererState, {
        onContextLost: (state, message) => {
            appEvents.emit(AppEvent.RENDERER_LOST, { reason: message ?? 'contextlost', state });
            if (!rendererBadge) {
                rendererBadge = createRendererBadge(state, { persistent: true });
            } else {
                getRendererBadgeApi()?.update(state, { status: 'lost', message });
            }
        },
        onContextRestored: (state) => {
            getRendererBadgeApi()?.update(state);
            applyLivePixelRatio(container, state.pixelRatio);
        },
        onDeviceLost: async (state, info) => {
            const message = info?.message ?? 'GPU device lost';
            appEvents.emit(AppEvent.RENDERER_LOST, { reason: message, state, info });
            if (!rendererBadge) {
                rendererBadge = createRendererBadge(state, { persistent: true });
            } else {
                getRendererBadgeApi()?.update(state, { status: 'lost', message });
            }

            if (state._recovering) return;
            state._recovering = true;
            getRendererBadgeApi()?.update(state, {
                status: 'recovering',
                message: 'Recovering via WebGL fallback…',
            });

            try {
                const oldCanvas = renderer.domElement;
                const nextState = await recoverRenderer(container, state);
                oldCanvas?.remove();

                renderer = nextState.renderer;
                rendererState = nextState;
                scene.userData.renderer = renderer;
                scene.userData.rendererState = rendererState;
                scene.userData.rendererType = rendererState.rendererType;
                app.renderer = renderer;
                app.rendererType = rendererState.rendererType;
                app.usingWebGPU = rendererState?.usingWebGPU === true;
                app.usingWebGL = rendererState?.usingWebGL !== false;
                app.rendererFallbackReason = rendererState?.fallbackReason ?? null;

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
                getRendererBadgeApi()?.update(rendererState);
                console.warn('[Renderer] Recovered from GPU loss via WebGL fallback.');
            } catch (error) {
                console.error('[Renderer] Recovery failed:', error);
                getRendererBadgeApi()?.update(rendererState, {
                    status: 'lost',
                    message: `${message} — reload page`,
                });
            } finally {
                state._recovering = false;
            }
        },
    });
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (!container || !renderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const pixelRatio = rendererState?.pixelRatio ?? renderer.getPixelRatio();

    const { startZ } = applyViewportToCamera(camera, width, height);
    cameraController?.reframeDefaultDistance?.(startZ);
    applyRendererSize(renderer, width, height, pixelRatio);
    syncComposerPixelRatio(composer, width, height, pixelRatio);
}

function animate() {
    const deltaTime = clock.getDelta();
    const time = clock.getElapsedTime();
    scheduler.runFrame({ deltaTime, time, renderer, composer, scene, camera });
}
