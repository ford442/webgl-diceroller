import * as THREE from 'three';
// WebGPURenderer import path depends on three.js version and build
import { WebGPURenderer } from 'three/webgpu';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from './shaders/VignetteShader.js';

import { initPhysics, stepPhysics, createFloorAndWalls } from './physics.js';
import { loadDiceModels, spawnObjects, updateDiceVisuals, updateDiceSet, throwDice, spawnedDice } from './dice.js';
import { initUI, createCrosshair } from './ui.js';
import { initInteraction, updateInteraction, registerInteractiveObject } from './interaction.js';
import { createTable } from './environment/Table.js';
import { createTavernWalls } from './environment/TavernWalls.js';
import { createBookshelf } from './environment/Bookshelf.js';
import { createChair } from './environment/Chair.js';
import { createChest } from './environment/Chest.js';
import { createClutter } from './environment/Clutter.js';
import { createTavernMeal } from './environment/TavernMeal.js';
import { createDagger } from './environment/Dagger.js';
import { createShield } from './environment/Shield.js';
import { createBattleAxe } from './environment/BattleAxe.js';
import { createDiceBag } from './environment/DiceBag.js';
import { createHourglass } from './environment/Hourglass.js';
import { createAtmosphere, updateAtmosphere } from './environment/Atmosphere.js';
import { createLamp } from './environment/Lamp.js';
import { createRug } from './environment/Rug.js';
import { createMap } from './environment/Map.js';
import { createCrystalBall } from './environment/CrystalBall.js';
import { createDiceTower } from './environment/DiceTower.js';
import { createDiceJail } from './environment/DiceJail.js';
import { createPotionSet } from './environment/PotionSet.js';
import { TavernEnvironment } from './environment/TavernEnvironment.js';

let camera, scene, renderer, composer;
let physicsWorld;
let clock;
let ui, crosshairUI;
let pointLight; // Exposed for flickering
let fireplaceLight; // Fireplace light
let candleFlamePos; // Position of the candle flame
let clutterUpdate; // Update function for clutter (fire)
let wallsUpdate; // Update function for walls (fireplace)
let velocity = new THREE.Vector3();
let isOnGround = true;
const moveSpeed = 5; // Units per second
const jumpForce = 8;
const gravity = -20; // Downward acceleration

// Camera Control Variables
let yaw = 0;
let pitch = 0;
const maxPitch = Math.PI / 2 - 0.1;
const keys = {};

// "Eye-Head" Cursor Logic
let cursorPos = new THREE.Vector2(0, 0); // Pixel coordinates relative to center
let isLocked = false;
let interaction; // Interaction handler

// Dice Focus Logic
const DiceFocusState = {
    IDLE: 'IDLE',
    WAITING_FOR_STOP: 'WAITING_FOR_STOP',
    FOCUSING: 'FOCUSING',
    HOLDING: 'HOLDING',
    RETURNING: 'RETURNING'
};
let diceFocusState = DiceFocusState.IDLE;
let focusTimer = 0;
let savedCameraState = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
let focusTargetPosition = new THREE.Vector3();
let focusStartPos = new THREE.Vector3();
let focusStartRot = new THREE.Quaternion();
let focusEndRot = new THREE.Quaternion();
let focusProgress = 0;

init();

async function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Darker for atmosphere

    // Camera setup
    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 6.0, 18); // Standing height proportional to room
    camera.lookAt(0, -3, 0);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8; // Darker exposure for mood
    document.body.appendChild(renderer.domElement);

    // Setup Event Listeners
    setupInput();

    // Lights
    // Ambient light (low intensity)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Very low ambient to make candle pop
    scene.add(ambientLight);

    // Warm PointLight (Candle) - Key Light
    // Initial setup, position will be updated by clutter
    // Deeper orange/red for a warmer, cozier feel (0xff9933)
    pointLight = new THREE.PointLight(0xff9933, 2.5, 20);
    pointLight.position.set(3, 6, 3); // Default if no candle
    pointLight.castShadow = true;
    pointLight.shadow.bias = -0.001; // Adjusted bias to prevent acne
    pointLight.shadow.mapSize.width = 2048;
    pointLight.shadow.mapSize.height = 2048;
    pointLight.shadow.radius = 5; // Softer shadows
    scene.add(pointLight);

    // Cool SpotLight (Moonlight) - Shining through the window
    // More blue, lower intensity for contrast (0x4444dd)
    const spotLight = new THREE.SpotLight(0x4444dd, 5.0);
    spotLight.position.set(-45, 15, -5); // Outside the window
    spotLight.target.position.set(0, -3, 0); // Aim at table center
    spotLight.angle = Math.PI / 10;
    spotLight.distance = 100;
    spotLight.penumbra = 0.5;
    spotLight.castShadow = true;
    spotLight.shadow.bias = -0.0001;
    spotLight.shadow.mapSize.width = 2048;
    spotLight.shadow.mapSize.height = 2048;
    scene.add(spotLight);
    scene.add(spotLight.target);

    // Fog for depth
    scene.fog = new THREE.FogExp2(0x111111, 0.02);

    // Post-Processing
    const params = new URLSearchParams(window.location.search);
    if (!params.has('no-post')) {
        composer = new EffectComposer(renderer);

        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);

        // Bloom
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0.6; // High threshold to only catch flames/lights
        bloomPass.strength = 0.6; // Soft glow
        bloomPass.radius = 0.4;
        composer.addPass(bloomPass);

        // Vignette
        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms['offset'].value = 1.2;
        vignettePass.uniforms['darkness'].value = 1.8; // Darker vignette
        composer.addPass(vignettePass);

        // Output Pass
        const outputPass = new OutputPass();
        composer.addPass(outputPass);
    }

    // Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const tavernEnvironment = new TavernEnvironment();
    scene.environment = pmremGenerator.fromScene(tavernEnvironment).texture;
    pmremGenerator.dispose();
    tavernEnvironment.dispose();

    // Initialize Physics
    try {
        physicsWorld = await initPhysics();

        // Environment
        const wallData = createTavernWalls(scene, physicsWorld);
        if (wallData) {
            if (wallData.fireplaceLight) fireplaceLight = wallData.fireplaceLight;
            if (wallData.update) wallsUpdate = wallData.update;
        }

        const tableConfig = createTable(scene);
        createFloorAndWalls(scene, physicsWorld, tableConfig);

        // Bookshelf (Background Prop)
        createBookshelf(scene, physicsWorld, { x: -18, y: -10, z: 0 }, Math.PI / 2);

        // Chairs (Background Props)
        createChair(scene, physicsWorld, { x: -14, y: -9.5, z: 6 }, Math.PI / 3);
        createChair(scene, physicsWorld, { x: 14, y: -9.5, z: -6 }, -Math.PI / 3);

        // Wooden Chest (Background Prop)
        createChest(scene, physicsWorld, { x: -10, y: -9.5, z: -18 }, Math.PI / 8);

        // Clutter & Candle
        const clutterData = createClutter(scene, physicsWorld);
        if (clutterData) {
            if (clutterData.flamePosition) {
                candleFlamePos = clutterData.flamePosition;
                // Move light to flame
                pointLight.position.copy(candleFlamePos);
                // Slightly above the wick visual
                pointLight.position.y += 0.05;
            }
            if (clutterData.update) clutterUpdate = clutterData.update;
        }

        // Dice Tower
        createDiceTower(scene, physicsWorld);

        // Dice Jail
        createDiceJail(scene, physicsWorld);

        // Tavern Meal (Tankard & Plate)
        createTavernMeal(scene, physicsWorld);

        // Dagger
        createDagger(scene, physicsWorld);

        // Shield (Wall Mount)
        createShield(scene, physicsWorld);

        // Battle Axe (Leaning)
        createBattleAxe(scene, physicsWorld);

        // Leather Dice Bag
        createDiceBag(scene, physicsWorld);

        // Hourglass
        createHourglass(scene, physicsWorld);

        // Billiard Lamp
        const lampData = await createLamp(scene);
        // Position high up (hanging from ceiling at Y=20)
        lampData.group.position.set(0, 19, 0);
        // Add to interactive objects
        registerInteractiveObject(lampData.group, lampData.toggle);

        // Atmosphere (Dust Motes)
        createAtmosphere(scene);

        // Rug
        createRug(scene);

        // Map
        createMap(scene, physicsWorld);

        // Crystal Ball
        createCrystalBall(scene, physicsWorld);

        // Alchemist's Potion Set
        createPotionSet(scene, physicsWorld);

    } catch (e) {
        console.error("Failed to initialize physics", e);
        return;
    }

    // Load Models and Spawn Dice
    await loadDiceModels();
    spawnObjects(scene, physicsWorld);

    // UI Setup
    ui = initUI(
        (newCounts) => {
            updateDiceSet(scene, physicsWorld, newCounts);
        },
        () => {
            throwDice(scene, physicsWorld);
            diceFocusState = DiceFocusState.WAITING_FOR_STOP;
        }
    );
    crosshairUI = createCrosshair();

    // Interaction Setup
    interaction = initInteraction(camera, scene, physicsWorld);

    clock = new THREE.Clock();

    // Expose for debugging/verification
    window.camera = camera;
    window.scene = scene;
    window.physicsWorld = physicsWorld;

    window.addEventListener('resize', onWindowResize);

    renderer.setAnimationLoop(animate);
}

function setupInput() {
    window.addEventListener('keydown', (event) => {
        keys[event.code] = true;
        if (event.code === 'KeyR') {
            throwDice(scene, physicsWorld);
            diceFocusState = DiceFocusState.WAITING_FOR_STOP;
        }
    });
    window.addEventListener('keyup', (event) => {
        keys[event.code] = false;
    });

    // Pointer Lock Request
    renderer.domElement.addEventListener('click', () => {
        if (!isLocked) {
            renderer.domElement.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        isLocked = document.pointerLockElement === renderer.domElement;
        crosshairUI.setVisible(isLocked);
        if (!isLocked) {
             // Reset cursor to center logic or handle unlock
        }
    });

    // Mouse Movement Tracking for "Eye-Head" System
    document.addEventListener('mousemove', (event) => {
        if (isLocked && diceFocusState === DiceFocusState.IDLE) {
            // Accumulate movement relative to center
            // We want the cursor to move freely within bounds
            cursorPos.x += event.movementX;
            cursorPos.y += event.movementY;

            // Interaction: pass current normalized coords (updated in animate or here)
            // But dragging requires continuous updates.
            // We'll update interaction in animate or via a specific call if needed.
            // Actually, interaction uses normalized coords (-1 to 1).
            // Let's compute them here for the interaction module's "handleMove"

            // Wait, interaction.handleMove is called with normalized coords.
            // We will do that in the animate loop or here.
            // But we need to clamp cursorPos first.

            const halfWidth = window.innerWidth / 2;
            const halfHeight = window.innerHeight / 2;

            // Clamp cursor to screen bounds
            cursorPos.x = Math.max(-halfWidth, Math.min(halfWidth, cursorPos.x));
            cursorPos.y = Math.max(-halfHeight, Math.min(halfHeight, cursorPos.y));

            const normX = cursorPos.x / halfWidth;
            const normY = cursorPos.y / halfHeight; // Y is usually inverted in 3D, check interaction.js expects -1 to 1?
            // interaction.js: mouse.y = -(event.clientY / h) * 2 + 1.
            // Normalized: Top of screen = +1. Bottom = -1.
            // Our cursorPos.y is pixel offset. Positive is usually DOWN in 2D coords.
            // So if cursorPos.y is positive (bottom), normY should be negative.

            interaction.handleMove(normX, -normY);
        }
    });

    // Pass clicks to interaction
    document.addEventListener('mousedown', (event) => {
        if (isLocked && diceFocusState === DiceFocusState.IDLE) {
            const halfWidth = window.innerWidth / 2;
            const halfHeight = window.innerHeight / 2;
            const normX = cursorPos.x / halfWidth;
            const normY = cursorPos.y / halfHeight;
            interaction.handleDown(normX, -normY);
        }
    });

    document.addEventListener('mouseup', () => {
        if (isLocked) {
            interaction.handleUp();
        }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function checkDiceStability() {
    if (spawnedDice.length === 0) return true;
    let allStable = true;
    spawnedDice.forEach(d => {
        if (!d.body) return;
        const vel = d.body.getLinearVelocity().length();
        const ang = d.body.getAngularVelocity().length();
        if (vel > 0.1 || ang > 0.1) allStable = false;
    });
    return allStable;
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

    // Update Crosshair UI Position
    // Center of screen is (window.innerWidth/2, window.innerHeight/2)
    // cursorPos is offset from that center.
    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;
    crosshairUI.updatePosition(screenCenterX + cursorPos.x, screenCenterY + cursorPos.y);

    // Update Atmosphere
    updateAtmosphere(time);
    if (clutterUpdate) clutterUpdate(deltaTime);
    if (wallsUpdate) wallsUpdate(deltaTime, time);

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

  
    // --- Camera & Movement Logic ---

    // Dice Focus State Machine
    if (diceFocusState === DiceFocusState.WAITING_FOR_STOP) {
        if (checkDiceStability()) {
            diceFocusState = DiceFocusState.FOCUSING;

            // Save current state
            savedCameraState.position.copy(camera.position);
            savedCameraState.rotation.copy(camera.rotation);

            // Calculate center
            const center = new THREE.Vector3();
            spawnedDice.forEach(d => center.add(d.mesh.position));
            if (spawnedDice.length > 0) center.divideScalar(spawnedDice.length);

            // Calculate Spread (Standard Deviation-ish) to determine camera distance
            let maxDist = 0;
            spawnedDice.forEach(d => {
                const dist = d.mesh.position.distanceTo(center);
                if (dist > maxDist) maxDist = dist;
            });

            // Dynamic camera offset:
            // Higher (y) and further back (z) if dice are spread out.
            // Base offset (0, 8, 4) + spread factor
            const zoomOut = Math.max(1, maxDist * 0.8);
            focusTargetPosition.copy(center).add(new THREE.Vector3(0, 8 + zoomOut, 4 + zoomOut));

            // Setup Tween
            focusStartPos.copy(camera.position);
            focusStartRot.setFromEuler(camera.rotation);

            // Calculate look rotation
            const dummyCam = camera.clone();
            dummyCam.position.copy(focusTargetPosition);
            dummyCam.lookAt(center);
            focusEndRot.copy(dummyCam.quaternion);

            focusProgress = 0;
        }
    } else if (diceFocusState === DiceFocusState.FOCUSING) {
        focusProgress += deltaTime * 2.0; // 0.5s transition
        if (focusProgress > 1) focusProgress = 1;

        // Slerp/Lerp
        camera.position.lerpVectors(focusStartPos, focusTargetPosition, focusProgress);
        camera.quaternion.slerpQuaternions(focusStartRot, focusEndRot, focusProgress);

        if (focusProgress === 1) {
            diceFocusState = DiceFocusState.HOLDING;
            focusTimer = 2.0; // Hold for 2s
        }
    } else if (diceFocusState === DiceFocusState.HOLDING) {
        focusTimer -= deltaTime;
        if (focusTimer <= 0) {
            diceFocusState = DiceFocusState.RETURNING;
            focusStartPos.copy(camera.position);
            focusStartRot.copy(camera.quaternion);

            focusTargetPosition.copy(savedCameraState.position);
            const dummyCam = camera.clone();
            dummyCam.rotation.copy(savedCameraState.rotation); // Euler to Quat
            focusEndRot.copy(dummyCam.quaternion);

            focusProgress = 0;
        }
    } else if (diceFocusState === DiceFocusState.RETURNING) {
        focusProgress += deltaTime * 2.0;
        if (focusProgress > 1) focusProgress = 1;

        camera.position.lerpVectors(focusStartPos, focusTargetPosition, focusProgress);
        camera.quaternion.slerpQuaternions(focusStartRot, focusEndRot, focusProgress);

        if (focusProgress === 1) {
            diceFocusState = DiceFocusState.IDLE;
            // Restore exact Euler to prevent gimbal issues or drift
            camera.rotation.copy(savedCameraState.rotation);
            // Sync pitch/yaw vars
            pitch = camera.rotation.x;
            yaw = camera.rotation.y;
        }
    }

    // Only allow player control if IDLE
    if (diceFocusState === DiceFocusState.IDLE) {
        // "Eye-Head" Camera Logic
        // If cursor is far from center, rotate camera to bring it back.
        const deadZone = 10; // Reduced from 50 for tighter response
        const turnSensitivity = 2.5; // Slightly faster

        if (isLocked) {
            // Yaw (Turning Left/Right)
            if (Math.abs(cursorPos.x) > deadZone) {
                const sign = Math.sign(cursorPos.x);
                const magnitude = (Math.abs(cursorPos.x) - deadZone) / (screenCenterX - deadZone); // 0 to 1
                yaw -= sign * magnitude * turnSensitivity * deltaTime;
            }

            // Pitch (Looking Up/Down)
            if (Math.abs(cursorPos.y) > deadZone) {
                const sign = Math.sign(cursorPos.y); // Positive Y is down
                const magnitude = (Math.abs(cursorPos.y) - deadZone) / (screenCenterY - deadZone);
                pitch -= sign * magnitude * turnSensitivity * deltaTime; // Looking down (positive Y) means decreasing pitch?
                // Usually pitch: up is positive, down is negative.
                // Mouse down -> decrease pitch.
            }

            // Clamp pitch
            pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
        }

        // Movement logic
        const direction = new THREE.Vector3();
        if (keys['KeyW']) direction.z -= 1; // Back (towards camera) -> Forward
        if (keys['KeyS']) direction.z += 1; // Forward (away from camera) -> Backward
        if (keys['KeyA']) direction.x -= 1; // Left
        if (keys['KeyD']) direction.x += 1; // Right
        if (keys['Space'] && isOnGround) {
            velocity.y = jumpForce;
            isOnGround = false;
        }

        // Normalize direction and apply to velocity
        if (direction.length() > 0) {
            direction.normalize();
            // Rotate direction by camera yaw for forward/back relative to view
            direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            velocity.x = direction.x * moveSpeed;
            velocity.z = direction.z * moveSpeed;
        } else {
            velocity.x = 0;
            velocity.z = 0;
        }

        // Apply gravity
        velocity.y += gravity * deltaTime;

        // Update position
        camera.position.add(velocity.clone().multiplyScalar(deltaTime));

    // Ground collision
    // 6.0 is the standing eye height relative to the floor.
    // (Floor Y = -9.5, Table Y = -3.0. Standing height ~15.5 units above floor -> -9.5 + 15.5 = 6.0)
        if (camera.position.y <= 6.0) {
            camera.position.y = 6.0;
            velocity.y = 0;
            isOnGround = true;
        }

        // Optional: Simple bounds to stay in room (adjust based on your room size)
        camera.position.x = Math.max(-18, Math.min(18, camera.position.x));
        camera.position.z = Math.max(-18, Math.min(18, camera.position.z));

        // Update camera rotation
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}
