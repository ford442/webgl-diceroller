import * as THREE from 'three';

import { initPhysics, stepPhysics } from './physics.js';
import { updateDiceVisuals, throwDice } from './dice.js';
import { showResults, hideResults } from './results.js';
import { updateInteraction } from './interaction.js';
import { updateAtmosphere } from './environment/Atmosphere.js';
import { setupScene } from './core/SceneSetup.js';
import { loadTiers, LampMode } from './core/LoadingTiers.js';
import { setupInput } from './core/InputHandler.js';
import { createCameraController, DiceFocusState } from './core/CameraController.js';

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

// Update registry - centralizes all per-frame update functions
const updateRegistry = {
    updates: [],
    register(name, fn) { this.updates.push({ name, fn }); },
    runAll(deltaTime, time) {
        for (const { fn } of this.updates) fn(deltaTime, time);
    }
};

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

    // Camera controller (focus state + FPS movement)
    cameraController = createCameraController(camera);

    // Load all tiers
    const tierResult = await loadTiers(scene, camera, physicsWorld, updateRegistry, {
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

    // Step physics
    if (physicsWorld) {
        stepPhysics(physicsWorld, deltaTime);
        updateDiceVisuals();
        updateInteraction();
    }

    // Update Crosshair UI Position - always centered in FPS mode
    if (crosshairUI) {
        const container = document.getElementById('canvas-container');
        const rect = container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
        const screenCenterX = rect.width / 2;
        const screenCenterY = rect.height / 2;
        crosshairUI.updatePosition(screenCenterX, screenCenterY);
    }

    // Update Atmosphere
    updateAtmosphere(time);

    // Run all registered update functions
    updateRegistry.runAll(deltaTime, time);

    // Get gong flash intensity for screen effect
    if (gongData && gongData.getFlashIntensity) {
        gongFlashIntensity = gongData.getFlashIntensity();
    }

    // Candle Flicker
    if (pointLight && candleFlamePos) {
        // More organic flicker
        // 1. Low frequency breathing (wind drafts)
        const breathing = Math.sin(time * 2.0) * 0.2;
        // 2. High frequency flicker
        const flicker = (Math.random() - 0.5) * 0.3;

        pointLight.intensity = 2.5 + breathing + flicker;

        // Jitter position based on flicker intensity (flame moves when it flickers)
        const jitterAmount = 0.03;
        const jitterX = (Math.random() - 0.5) * jitterAmount;
        const jitterY = (Math.random() - 0.5) * jitterAmount * 0.5;
        const jitterZ = (Math.random() - 0.5) * jitterAmount;

        pointLight.position.set(
            candleFlamePos.x + jitterX,
            candleFlamePos.y + 0.1 + jitterY, // Slightly higher above wick
            candleFlamePos.z + jitterZ
        );
    }

    // Fireplace Flicker
    if (fireplaceLight) {
        // Slower, deeper flicker for a big fire
        const deepPulse = Math.sin(time * 3.0) * 0.5; // Slow breath
        const crackle = (Math.random() - 0.5) * 1.0; // Random intense crackle

        fireplaceLight.intensity = 5.0 + deepPulse + crackle;
    }

    // Camera & Movement Logic
    cameraController.update(deltaTime, time, {
        keys: inputState.keys,
        cursorPos,
        isLocked: isLockedRef.value,
        showResults,
        hideResults,
        lampData,
        LampMode
    });

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}
