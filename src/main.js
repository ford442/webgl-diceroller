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
import { createClutter } from './environment/Clutter.js';
import { RoomEnvironment } from './environment/RoomEnvironment.js';

let camera, scene, renderer, composer;
let physicsWorld;
let clock;
let ui;
let pointLight; // Exposed for flickering
let candleFlamePos; // Position of the candle flame

init();

async function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Darker for atmosphere

    // Camera setup
    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, -5);
    camera.lookAt(0, -3, 0);

    // Lights
    // Ambient light (low intensity)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Very low ambient to make candle pop
    scene.add(ambientLight);

    // Warm PointLight (Candle) - Key Light
    // Initial setup, position will be updated by clutter
    pointLight = new THREE.PointLight(0xffaa55, 2.0, 15); // Range reduced for intimacy
    pointLight.position.set(3, 6, 3); // Default if no candle
    pointLight.castShadow = true;
    pointLight.shadow.bias = -0.0005;
    pointLight.shadow.mapSize.width = 2048;
    pointLight.shadow.mapSize.height = 2048;
    pointLight.shadow.radius = 4; // Soft shadows
    scene.add(pointLight);

    // Cool SpotLight (Moonlight/Rim) - Fill/Rim Light
    const spotLight = new THREE.SpotLight(0x8888ff, 0.8); // Reduced intensity
    spotLight.position.set(-10, 10, -5);
    spotLight.angle = Math.PI / 4;
    spotLight.penumbra = 1.0;
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
    renderer.toneMappingExposure = 1.0;
    document.body.appendChild(renderer.domElement);

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
        // Flicker intensity
        // Base 2.0, plus sine wave for breathing, plus noise for flicker
        const flicker = Math.sin(time * 10) * 0.1 + (Math.random() - 0.5) * 0.2;
        pointLight.intensity = 2.0 + flicker;

        // Jitter position slightly
        const jitterX = (Math.random() - 0.5) * 0.02;
        const jitterZ = (Math.random() - 0.5) * 0.02;
        pointLight.position.set(
            candleFlamePos.x + jitterX,
            candleFlamePos.y + 0.05, // Keep Y mostly stable
            candleFlamePos.z + jitterZ
        );
    }

    composer.render();
}
