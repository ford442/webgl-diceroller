import * as THREE from 'three';

import { isWasmAvailable } from './wasm/PhysicsBridge.js';
import {
    syncAllDiceToWasm,
    areDiceSettled,
    readAllDiceValues,
    getDiceValueDebugSnapshot,
    replaceDiceSet,
    getDiceAppearanceConfig,
    buildDicePresencePayload,
    applyDicePresencePayload,
    refreshDiceAppearance,
} from './dice.js';
import { isDragging, hasActiveDiceInteraction } from './interaction.js';
import {
    createDiceCupController,
    registerDiceCupController,
    getDiceCupController,
} from './interaction/DiceCupController.js';
import { setInteractablesMirror } from './interactables/InteractableRegistry.js';
import { createDiceCollisionAudio } from './audio/DiceCollisionAudio.js';
import { setupScene } from './core/SceneSetup.js';
import { createAppContext } from './core/AppContext.js';
import { createAppEvents, AppEvent } from './core/AppEvents.js';
import { installAppTestHooks } from './core/AppTestHooks.js';
import { applyRendererSize, syncComposerPixelRatio } from './core/RendererFactory.js';
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
import { createCameraController } from './core/CameraController.js';
import { createFrameScheduler } from './core/FrameScheduler.js';
import { createRollHistory } from './roll/RollHistory.js';
import { createRollStats } from './roll/RollStats.js';
import { createRollHistoryPanel } from './ui/RollHistoryPanel.js';
import { createCullingSystem } from './core/CullingSystem.js';
import { applyViewportToCamera } from './core/SceneMetrics.js';
import { isTouchPrimaryDevice } from './core/DeviceCapabilities.js';
import { createDiceGameFeelSystem } from './effects/DiceGameFeel.js';
import { registerFrameCallbacks } from './app/SchedulerSetup.js';
import { createRollWiring } from './app/RollWiring.js';
import { installDebugGlobals } from './app/DebugGlobals.js';
import { setupMultiplayer } from './app/MultiplayerWiring.js';
import { bootstrapPhysics, showLoadFailure } from './app/PhysicsBootstrap.js';
import { startPostLoadAdaptiveProbe } from './core/AdaptiveQuality.js';
import { bootstrapRendererExtras } from './app/RendererBootstrap.js';
import { buildTierLoadOptions } from './app/TierLoadOptions.js';
import { bootstrapXr } from './app/XrBootstrap.js';
import { createShadowController } from './app/RendererRecovery.js';

/** @typedef {import('./types/app').ComposerLike} ComposerLike */
/** @typedef {import('./types/app').PostConfig} PostConfig */
/** @typedef {import('./types/app').RendererState} RendererState */
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
/** @type {ReturnType<typeof import('./core/RuntimeQualityGovernor.js').createRuntimeQualityGovernor> | null} */
let runtimeGovernor = null;
/** @type {ReturnType<typeof import('./core/PostRuntimeControls.js').createPostRuntimeControls> | null} */
let postRuntime = null;
let fairnessMonitor = null;
let rollHistory = null;
let rollStats = null;
let rollHistoryPanel = null;
let collisionAudio = null;
const collisionTotal = { value: 0 };
let diceGameFeel = null;
let diceCupController = null;
/** @type {{ current: ReturnType<typeof import('./net/RoomSession.js').createRoomSession> | null }} */
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

// "Eye-Head" Cursor Logic
const cursorPos = new THREE.Vector2(0, 0); // Pixel coordinates relative to center
const isLockedRef = { value: false };
/** @type {{ value: boolean }} */
const isXrPresentingRef = { value: false };

let cameraController;
/** @type {ReturnType<typeof import('./core/InputHandler.js').setupInput> | undefined} */
let inputState;

init();

async function init() {
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
    postRuntime = sceneSetup.postRuntime;
    shadowController = createShadowController(() => renderer, scene);
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

    const rollWiring = createRollWiring(app, {
        appEvents,
        getScene: () => scene,
        getPhysicsWorld: () => physicsWorld,
        getShadowController: () => shadowController,
        getDiceGameFeel: () => diceGameFeel,
        getCameraController: () => cameraController,
        getLampData: () => lampData,
        getUi: () => ui,
        rollHistory,
        rollStats,
        getFairnessMonitor: () => fairnessMonitor,
        getRollHistoryPanel: () => rollHistoryPanel,
        multiplayerRef,
        getCollisionAudio: () => collisionAudio,
    });

    const rendererRecoveryDeps = {
        app,
        scene,
        appEvents,
        getRenderer: () => renderer,
        setRenderer: (r) => {
            renderer = r;
        },
        getComposer: () => composer,
        setComposer: (c) => {
            composer = c;
        },
        getRendererState: () => rendererState,
        setRendererState: (s) => {
            rendererState = s;
        },
        getRendererBadgeApi: () => rendererBadge,
        setRendererBadge: (b) => {
            rendererBadge = b;
        },
        getPostConfig: () => postConfig,
        animate,
        onRecovered: () => {
            if (!adaptiveQualityState) return;
            adaptiveQualityState.renderer = rendererRecoveryDeps.getRenderer();
            adaptiveQualityState.composer = rendererRecoveryDeps.getComposer();
            adaptiveQualityState.rendererState = rendererRecoveryDeps.getRendererState();
        },
    };

    ({ renderStats, fairnessMonitor, adaptiveQualityState, runtimeGovernor } =
        bootstrapRendererExtras(app, {
            scene,
            renderer,
            composer,
            rendererState,
            postConfig,
            spotLight,
            pointLight,
            scheduler,
            cullingSystem,
            container,
            debugEnabled,
            searchParams,
            rollStats,
            getShadowController: () => shadowController,
            getCollisionAudio: () => collisionAudio,
            getTierRenderStats: () => tierRenderStats,
            getCollisionTotal: () => collisionTotal.value,
            setRendererBadge: (b) => {
                rendererBadge = b;
            },
            rendererRecoveryDeps,
            postRuntime,
            getDiceGameFeel: () => diceGameFeel,
        }));

    registerFrameCallbacks(scheduler, {
        app,
        isSimulationReady,
        getPhysicsWorld: () => physicsWorld,
        getCamera: () => camera,
        getRenderer: () => renderer,
        getComposer: () => composer,
        scene,
        cullingSystem,
        appEvents,
        getCollisionAudio: () => collisionAudio,
        getCameraController: () => cameraController,
        getInputState: () => inputState,
        getLampData: () => lampData,
        getGongData: () => gongData,
        getCandleFlamePos: () => candleFlamePos,
        getFireplaceLight: () => fireplaceLight,
        getDiceCupController: () => diceCupController,
        shadowController,
        getDiceGameFeel: () => diceGameFeel,
        pointLight,
        postConfig,
        getRendererState: () => rendererState,
        adaptiveQualityState,
        runtimeGovernor,
        postRuntime,
        renderStats,
        debugEnabled,
        isLockedRef,
        cursorPos,
        isXrPresentingRef,
        addCollisionTotal: (n) => {
            collisionTotal.value += n;
        },
    });

    // Start the clock and render loop immediately so the browser shows something
    // while the physics engine (WASM) compiles and initialises in the background.
    clock = new THREE.Clock();
    window.addEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(animate);

    // Initialize Physics — awaited here but the render loop above is already running,
    // so the browser paints every frame while WASM compiles/allocates.
    const physicsBoot = await bootstrapPhysics(app);
    if (!physicsBoot) return;
    physicsWorld = physicsBoot.physicsWorld;
    if (physicsBoot.wasmAvailable) {
        syncAllDiceToWasm();
    }

    // Camera controller (focus state + FPS movement)
    cameraController = createCameraController(camera);

    // Load all tiers
    let tierResult;
    try {
        tierResult = await loadTiers(
            scene,
            camera,
            physicsWorld,
            { scheduler, cullingSystem },
            buildTierLoadOptions(app, {
                collisionAudio,
                qualityProfile: postConfig?.adaptiveProfile ?? app.qualityProfile ?? null,
                multiplayerRef,
                rollWiring,
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
                getDiceCupController: () => diceCupController,
                getShadowController: () => shadowController,
            }),
            renderer
        );
    } catch (e) {
        console.error('Failed to load scene tiers', e);
        showLoadFailure('Error: Scene failed to load. Check console.');
        return;
    }

    ui = tierResult.ui;
    app.ui = ui;
    crosshairUI = tierResult.crosshairUI;
    tierRenderStats = tierResult.tierRenderStats ?? null;
    app.tierRenderStats = tierRenderStats;
    startPostLoadAdaptiveProbe(adaptiveQualityState, scheduler);
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
            beginCupRoll: rollWiring.beginCupRoll,
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

    rollWiring.initRollSession({ replaceDiceSet, readAllDiceValues, areDiceSettled });

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
        onRoll: (seed = null) => rollWiring.rollHandlerRef.roll(seed),
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

    await bootstrapXr({
        searchParams,
        app,
        scheduler,
        renderer,
        scene,
        camera,
        getShadowController: () => shadowController,
        isXrPresentingRef,
        getCrosshairUI: () => crosshairUI,
    });

    rollHistoryPanel = createRollHistoryPanel({
        rollHistory,
        rollStats,
        onReplay: (seed) => rollWiring.beginRoll(seed),
    });

    installDebugGlobals(app, {
        appEvents,
        rollWiring,
        getLayoutManager: () => layoutManager,
        getShadowController: () => shadowController,
        rollStats,
        getFairnessMonitor: () => fairnessMonitor,
        getRollHistoryPanel: () => rollHistoryPanel,
        readAllDiceValues,
        areDiceSettled,
        getDiceValueDebugSnapshot,
        getDiceAppearanceConfig,
        buildDicePresencePayload,
        applyDicePresencePayload,
        refreshDiceAppearance,
        multiplayerRef,
    });

    const { roomParam } = setupMultiplayer(app, {
        searchParams,
        appEvents,
        multiplayerRef,
        rollWiring,
    });

    // Room deep-link wins over one-shot shareable seed replay.
    rollWiring.replayShareableRoll(searchParams, { skip: Boolean(roomParam) });
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
