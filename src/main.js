import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { initPhysics, stepPhysics, createFloorAndWalls } from './physics.js';
import { loadDiceModels, spawnObjects, updateDiceVisuals } from './dice.js';

let camera, scene, renderer;
let stats;
let physicsWorld;
let clock;

init();

async function init() {
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfd1e5);

    // Camera setup
    camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, -5);
    camera.lookAt(0, -3, 0);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff);
    dirLight.position.set(-10, 10, -10);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 40;
    scene.add(dirLight);

    // Renderer setup
    try {
        renderer = new WebGPURenderer({ antialias: true });
        await renderer.init();
        console.log('Using WebGPU');
    } catch (e) {
        console.warn('WebGPU not supported, falling back to WebGL2', e);
        renderer = new THREE.WebGLRenderer({ antialias: true });
    }

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Initialize Physics
    try {
        physicsWorld = await initPhysics();
        createFloorAndWalls(scene, physicsWorld);
    } catch (e) {
        console.error("Failed to initialize physics", e);
        return;
    }

    // Load Models and Spawn Dice
    await loadDiceModels();
    spawnObjects(scene, physicsWorld);

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
    }

    renderer.render(scene, camera);
}
