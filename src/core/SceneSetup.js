import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from '../shaders/VignetteShader.js';
import { TavernEnvironment } from '../environment/TavernEnvironment.js';

export async function setupScene(container) {
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Darker for atmosphere

    // Camera setup - 1:1 aspect ratio
    const camera = new THREE.PerspectiveCamera(80, 1, 0.1, 1000);
    camera.position.set(0, 6.0, 18); // Standing height proportional to room
    camera.lookAt(0, -3, 0);

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(1.0); // Fixed 1:1 pixel ratio for consistent performance
    renderer.setSize(containerWidth, containerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8; // Darker exposure for mood
    container.appendChild(renderer.domElement);
    scene.userData.renderer = renderer;

    // Lights
    // Ambient light (low intensity)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Very low ambient to make candle pop
    scene.add(ambientLight);

    // Warm PointLight (Candle) - Key Light
    // Initial setup, position will be updated by clutter
    // Deeper orange/red for a warmer, cozier feel (0xff9933)
    const pointLight = new THREE.PointLight(0xff9933, 2.5, 20);
    pointLight.position.set(3, 6, 3); // Default if no candle
    pointLight.castShadow = true;
    pointLight.shadow.bias = -0.001; // Adjusted bias to prevent acne
    pointLight.shadow.mapSize.width = 512;
    pointLight.shadow.mapSize.height = 512;
    pointLight.shadow.radius = 5; // Softer shadows
    pointLight.shadow.camera.near = 0.1;
    pointLight.shadow.camera.far = 25;
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
    spotLight.shadow.mapSize.width = 1024;
    spotLight.shadow.mapSize.height = 1024;
    scene.add(spotLight);
    scene.add(spotLight.target);

    // Fog for depth
    scene.fog = new THREE.FogExp2(0x111111, 0.02);

    // Post-Processing
    // Auto-detect low-end GPUs: disable post-processing if texture size is limited.
    // Devices with maxTextureSize < 4096 typically have underpowered GPUs where
    // fullscreen bloom passes would cause significant frame-rate drops.
    // The `?no-post` URL parameter always overrides this check for manual control.
    const isLowEnd = renderer.capabilities.maxTextureSize < 4096;

    let composer = null;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('no-post') && !isLowEnd) {
        composer = new EffectComposer(renderer);

        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);

        // Bloom — run at half resolution to save fillrate
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(Math.round(containerWidth / 2), Math.round(containerHeight / 2)),
            1.5, 0.4, 0.85
        );
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
    } else if (isLowEnd) {
        console.log('Post-processing disabled: low-end GPU detected');
    }

    // Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const tavernEnvironment = new TavernEnvironment();
    await tavernEnvironment.load();
    scene.environment = pmremGenerator.fromScene(tavernEnvironment).texture;
    pmremGenerator.dispose();
    tavernEnvironment.dispose();

    return { scene, camera, renderer, composer, pointLight, spotLight };
}
