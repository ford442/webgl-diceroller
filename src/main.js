import * as THREE from 'three';

import { initPhysics, stepPhysics } from './physics.js';
import { loadWasmEngine, isWasmAvailable, getWasmEngine } from './wasm/WasmPhysicsBridge.js';
import { updateDiceVisuals, throwDice, syncAllDiceToWasm } from './dice.js';
import { showResults, hideResults } from './results.js';
import { updateInteraction, hasActiveDiceInteraction } from './interaction.js';
import { updateAtmosphere } from './environment/Atmosphere.js';
import { setupScene } from './core/SceneSetup.js';
import { LampMode } from './environment/Lamp.js';
import { loadTiers } from './core/LoadingTiers.js';
import { setupInput } from './core/InputHandler.js';
import { createCameraController, DiceFocusState } from './core/CameraController.js';
import { createFrameScheduler } from './core/FrameScheduler.js';
import { createCandleFlickerSystem, createFireplaceFlickerSystem } from './core/LightingSystems.js';

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
const scheduler = createFrameScheduler({
    fixedDeltaTime: 1 / 60,
    maxPhysicsSteps: 5,
    debugPerf: searchParams.has('debug-perf')
});

// "Eye-Head" Cursor Logic
const cursorPos = new THREE.Vector2(0, 0); // Pixel coordinates relative to center
const isLockedRef = { value: false };

let cameraController;
let inputState;

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
    pointLight = sceneSetup.pointLight;
    window.__renderStats = scheduler.stats;

    scheduler.register('physicsStep', 'dicePhysics', ({ deltaTime }) => {
        if (!physicsWorld) return;

        const useWasm = isWasmAvailable();
        const shouldStepAmmo = !useWasm || dualPhysicsValidation || hasActiveDiceInteraction();

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

    scheduler.register('updates', 'interaction', () => {
        if (!physicsWorld) return;
        updateInteraction();
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
            LampMode
        });
    }, { priority: -10 });

    scheduler.register('preRender', 'gongFlash', () => {
        if (gongData?.getFlashIntensity) {
            gongFlashIntensity = gongData.getFlashIntensity();
        }
    });

    scheduler.register('preRender', 'candleFlicker', createCandleFlickerSystem(pointLight, () => candleFlamePos));
    scheduler.register('preRender', 'fireplaceFlicker', createFireplaceFlickerSystem(() => fireplaceLight));

    scheduler.register('render', 'sceneRender', () => {
        if (composer) {
            composer.render();
        } else {
            renderer.render(scene, camera);
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
    const tierResult = await loadTiers(scene, camera, physicsWorld, { scheduler }, {
        onDiceRoll: () => {
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
        setInteraction: (inter) => { interaction = inter; }
    });

    ui = tierResult.ui;
    crosshairUI = tierResult.crosshairUI;
    if (tierResult.fireplaceLight) fireplaceLight = tierResult.fireplaceLight;

    // Input handling
    inputState = setupInput({
        renderer,
        camera,
        interaction,
        diceFocusStateRef: { get value() { return cameraController.getState(); }, set value(v) { cameraController.setState(v); } },
        isLockedRef,
        cursorPos,
        crosshairUI,
        onRoll: () => {
            throwDice(scene, physicsWorld);
            cameraController.setState(DiceFocusState.WAITING_FOR_STOP);
            hideResults();
            if (lampData) lampData.setRolling(true);
        },
        getLampData: () => lampData
    });

    // Expose for debugging/verification
    window.camera = camera;
    window.scene = scene;
    window.physicsWorld = physicsWorld;
    window.THREE = THREE;
    window.renderer = renderer;
    // WASM engine exposed after loadWasmEngine() resolves (may be the stub)
    window.getWasmEngine = getWasmEngine;
    window.isWasmAvailable = isWasmAvailable;
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
