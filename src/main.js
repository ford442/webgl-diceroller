import * as THREE from 'three';
// WebGPURenderer import path depends on three.js version and build
// Trying to import from 'three/webgpu' which is mapped in package.json exports to ./build/three.webgpu.js
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { initPhysics, stepPhysics, createFloorAndWalls } from './physics.js';
import { loadDiceModels, spawnObjects, updateDiceVisuals, updateDiceSet, throwDice } from './dice.js';
import { initUI } from './ui.js';
import { initInteraction, updateInteraction } from './interaction.js';
import { createTable } from './environment/Table.js';
import { createRoom } from './environment/Room.js';
import { createClutter } from './environment/Clutter.js';
import { RoomEnvironment } from './environment/RoomEnvironment.js';

let camera, scene, renderer;
let physicsWorld;
let clock;
let ui;

init();

async function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222); // Darker, more atmospheric background

    // Camera setup
    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, -5);
    camera.lookAt(0, -3, 0);

    // Lights
    // Ambient light (low intensity)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    // Warm PointLight (Candle/Fireplace) - Key Light
    const pointLight = new THREE.PointLight(0xffaa55, 1.5, 50);
    pointLight.position.set(2, 5, 2);
    pointLight.castShadow = true;
    pointLight.shadow.bias = -0.0001;
    pointLight.shadow.mapSize.width = 1024;
    pointLight.shadow.mapSize.height = 1024;
    scene.add(pointLight);

    // Cool SpotLight (Moonlight/Rim) - Fill/Rim Light
    const spotLight = new THREE.SpotLight(0x8888ff, 0.8);
    spotLight.position.set(-10, 10, -5);
    spotLight.angle = Math.PI / 4;
    spotLight.penumbra = 0.5;
    spotLight.castShadow = true;
    scene.add(spotLight);

    // Renderer setup
    // Note: Switched to WebGLRenderer for stable PMREMGenerator/RoomEnvironment support
    // WebGPURenderer is currently experimental and has issues with PMREM in some environments
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    document.body.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnvironment = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(roomEnvironment).texture;
    // scene.background = scene.environment; // Optional: use environment as background
    pmremGenerator.dispose();
    roomEnvironment.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -3, 0);
    controls.update();

    // Initialize Physics
    try {
        physicsWorld = await initPhysics();

        // Environment
        createRoom(scene);
        const tableConfig = createTable(scene);
        // Pass tableConfig to physics to ensure walls align with visual tray
        createFloorAndWalls(scene, physicsWorld, tableConfig);
        createClutter(scene, physicsWorld);
    } catch (e) {
        console.error("Failed to initialize physics", e);
        return;
    }

    // Load Models and Spawn Dice
    await loadDiceModels();
    spawnObjects(scene, physicsWorld); // Initial spawn with defaults

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

    // Event listeners
    window.addEventListener('resize', onWindowResize);

    // Start loop
    renderer.setAnimationLoop(animate);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    const deltaTime = clock.getDelta();

    // Step physics
    if (physicsWorld) {
        stepPhysics(physicsWorld, deltaTime);
        updateDiceVisuals();
        updateInteraction();
    }

    renderer.render(scene, camera);
}
