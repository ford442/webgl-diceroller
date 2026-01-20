import * as THREE from 'three';
// WebGPURenderer import path depends on three.js version and build
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VignetteShader } from './shaders/VignetteShader.js';

import { initPhysics, stepPhysics, createFloorAndWalls } from './physics.js';
import { loadDiceModels, spawnObjects, updateDiceVisuals, updateDiceSet, throwDice } from './dice.js';
import { initUI } from './ui.js';
import { initInteraction, updateInteraction } from './interaction.js';
import { createTable } from './environment/Table.js';
import { createTavernWalls } from './environment/TavernWalls.js';
import { createBookshelf } from './environment/Bookshelf.js';
import { createClutter } from './environment/Clutter.js';
import { RoomEnvironment } from './environment/RoomEnvironment.js';

let camera, scene, renderer, composer;
let physicsWorld;
let clock;
let ui;
let pointLight; // Exposed for flickering
let candleFlamePos; // Position of the candle flame
let velocity = new THREE.Vector3();
let isOnGround = true;
const moveSpeed = 5; // Units per second
const jumpForce = 8;
const gravity = -20; // Downward acceleration


init();

async function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Darker for atmosphere

    // Camera setup
    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.7, 3); // Standing height near the table
    camera.lookAt(0, 0, 0);

        const keys = {};
    window.addEventListener('keydown', (event) => {
        keys[event.code] = true;
    });
    window.addEventListener('keyup', (event) => {
        keys[event.code] = false;
    });

      renderer.domElement.addEventListener('mousedown', (event) => {
        if (event.button === 2) { // Right-click for forward movement (while held)
            keys['RightClick'] = true;
        } else if (event.button === 0) { // Left-click for look (optional, if not conflicting with dice)
            isLooking = true;
        }
    });
    renderer.domElement.addEventListener('mouseup', (event) => {
        if (event.button === 2) {
            keys['RightClick'] = false;
        } else if (event.button === 0) {
            isLooking = false;
        }
    });
    renderer.domElement.addEventListener('mousemove', (event) => {
        if (isLooking) {
            const sensitivity = 0.002;
            yaw -= event.movementX * sensitivity;
            pitch -= event.movementY * sensitivity;
            pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
        }
    });
    
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

    // Cool SpotLight (Moonlight/Rim) - Fill/Rim Light
    // More blue, lower intensity for contrast (0x4444dd)
    const spotLight = new THREE.SpotLight(0x4444dd, 1.5);
    spotLight.position.set(-15, 12, -8);
    spotLight.angle = Math.PI / 5;
    spotLight.penumbra = 0.5;
    spotLight.castShadow = true;
    spotLight.shadow.bias = -0.0001;
    scene.add(spotLight);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8; // Darker exposure for mood
    document.body.appendChild(renderer.domElement);

    // Fog for depth
    scene.fog = new THREE.FogExp2(0x111111, 0.02);

    // Post-Processing
    composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Vignette
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms['offset'].value = 1.2;
    vignettePass.uniforms['darkness'].value = 1.8; // Darker vignette
    composer.addPass(vignettePass);

    // Output Pass
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnvironment = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(roomEnvironment).texture;
    pmremGenerator.dispose();
    roomEnvironment.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -3, 0);
    controls.update();

    // Initialize Physics
    try {
        physicsWorld = await initPhysics();

        // Environment
        createTavernWalls(scene, physicsWorld);
        const tableConfig = createTable(scene);
        createFloorAndWalls(scene, physicsWorld, tableConfig);

        // Bookshelf (Background Prop)
        createBookshelf(scene, physicsWorld, { x: -18, y: -10, z: 0 }, Math.PI / 2);

        // Clutter & Candle
        const clutterData = createClutter(scene, physicsWorld);
        if (clutterData && clutterData.flamePosition) {
            candleFlamePos = clutterData.flamePosition;
            // Move light to flame
            pointLight.position.copy(candleFlamePos);
            // Slightly above the wick visual
            pointLight.position.y += 0.05;
        }

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
        }
    );

    // Interaction Setup
    initInteraction(camera, scene, renderer.domElement, physicsWorld);

    clock = new THREE.Clock();

    window.addEventListener('resize', onWindowResize);

    renderer.setAnimationLoop(animate);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
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

  
    // Movement logic
    const direction = new THREE.Vector3();
    if (keys['KeyW']) direction.z -= 1; // Back (towards camera)
    if (keys['KeyS']) direction.z += 1; // Forward (away from camera)
    if (keys['KeyA']) direction.x -= 1; // Left
    if (keys['KeyD']) direction.x += 1; // Right
    if (keys['RightClick']) direction.z += 1; // Forward on right-click
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

    // Ground collision (simple: prevent going below y=1.7)
    if (camera.position.y <= 1.7) {
        camera.position.y = 1.7;
        velocity.y = 0;
        isOnGround = true;
    }

    // Optional: Simple bounds to stay in room (adjust based on your room size)
    camera.position.x = Math.max(-10, Math.min(10, camera.position.x));
    camera.position.z = Math.max(-10, Math.min(10, camera.position.z));

    // Update camera rotation
    camera.rotation.set(pitch, yaw, 0, 'YXZ');

    composer.render();
}
