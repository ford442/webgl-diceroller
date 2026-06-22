import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VignetteShader } from '../shaders/VignetteShader.js';
import { TavernEnvironment } from '../environment/TavernEnvironment.js';
import { createRenderer } from './RendererFactory.js';
import { preloadSharedTextures } from './TexturePipeline.js';
import { CAMERA_EYE_Y, CAMERA_LOOK_AT_Y, CAMERA_START_Z } from './SceneMetrics.js';

async function createWebGpuPostPipeline(renderer, scene, camera, { width, height, postConfig }) {
    const [
        { PostProcessing },
        { pass, uniform, float, vec2, vec3, vec4, mix, Fn, screenUV },
        { bloom },
        { chromaticAberration }
    ] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
        import('three/addons/tsl/display/BloomNode.js'),
        import('three/addons/tsl/display/ChromaticAberrationNode.js')
    ]);

    const postProcessing = new PostProcessing(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setSize(width, height);

    let outputNode = scenePass.getTextureNode('output');
    let bloomNode = null;

    if (postConfig.bloomEnabled) {
        bloomNode = bloom(
            outputNode,
            postConfig.quality === 'low' ? 0.35 : 0.6,
            postConfig.quality === 'low' ? 0.25 : 0.4,
            0.6
        );
        outputNode = outputNode.add(bloomNode);
    }

    const vignetteOffset = uniform(1.2);
    const vignetteDarkness = uniform(1.8);
    const vignetteNode = Fn(() => {
        const vignetteUv = screenUV.sub(vec2(0.5, 0.5)).mul(vignetteOffset);
        const vignetteColor = vec3(float(1.0).sub(vignetteDarkness));
        return vec4(
            mix(outputNode.rgb, vignetteColor, vignetteUv.dot(vignetteUv)),
            outputNode.a
        );
    })();

    outputNode = vignetteNode;

    if (postConfig.quality === 'high') {
        outputNode = chromaticAberration(outputNode, 0.2, vec2(0.5, 0.5), 1.08);
    }

    postProcessing.outputNode = outputNode;

    return {
        type: 'webgpu-post',
        render() {
            postProcessing.render();
        },
        setSize(nextWidth, nextHeight) {
            scenePass.setSize(nextWidth, nextHeight);
            bloomNode?.setSize?.(nextWidth, nextHeight);
        },
        dispose() {
            postProcessing.dispose();
        }
    };
}

async function compilePmremSceneShader(pmremGenerator) {
    if (typeof pmremGenerator.compileCubemapShader !== 'function') {
        return;
    }

    const compileResult = pmremGenerator.compileCubemapShader();
    if (typeof compileResult?.then === 'function') {
        await compileResult;
    }
}

export async function setupScene(container) {
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Darker for atmosphere

    // Camera setup - 1:1 aspect ratio
    const camera = new THREE.PerspectiveCamera(80, 1, 0.1, 1000);
    camera.position.set(0, CAMERA_EYE_Y, CAMERA_START_Z);
    camera.lookAt(0, CAMERA_LOOK_AT_Y, 0);

    // Renderer setup
    const rendererState = await createRenderer(container, { antialias: false });
    const renderer = rendererState.renderer;
    container.appendChild(renderer.domElement);
    scene.userData.renderer = renderer;
    scene.userData.rendererState = rendererState;
    scene.userData.rendererType = rendererState.rendererType;

    const params = new URLSearchParams(window.location.search);
    const hardwareConcurrency = navigator.hardwareConcurrency || 4;
    const hasWebGpu = rendererState.usingWebGPU || Boolean(navigator.gpu);
    const maxTextureSize = renderer.capabilities?.maxTextureSize ?? 4096;
    const isLowEndDevice = maxTextureSize < 4096 || hardwareConcurrency <= 4 || !hasWebGpu;
    const forceLowPost = params.has('low-post');
    const disablePost = params.has('no-post');
    const disableBloom = params.has('no-bloom');
    const disableGodRays = params.has('no-godrays');
    const postQuality = disablePost ? 'off' : ((isLowEndDevice || forceLowPost) ? 'low' : 'high');
    const postConfig = {
        quality: postQuality,
        bloomEnabled: !disablePost && !disableBloom,
        godRaysEnabled: !disableGodRays,
        lowEndDetected: isLowEndDevice,
        rendererType: rendererState.rendererType,
        requestedRenderer: rendererState.requestedRenderer,
        chromaticAberrationEnabled: rendererState.usingWebGPU && postQuality === 'high'
    };
    scene.userData.postConfig = postConfig;

    // God rays use a raw-GLSL ShaderMaterial that WebGPURenderer can't compile,
    // so preload a synchronous TSL NodeMaterial factory the tavern walls can use
    // instead. WebGL keeps the original ShaderMaterial path (no factory stashed).
    if (rendererState.usingWebGPU && postConfig.godRaysEnabled) {
        try {
            const { loadGodRayNodeMaterialFactory } = await import('../shaders/GodRayNodeMaterial.js');
            scene.userData.godRayMaterialFactory = await loadGodRayNodeMaterialFactory();
        } catch (error) {
            console.warn('[SceneSetup] God ray TSL material unavailable; disabling on WebGPU.', error);
            postConfig.godRaysEnabled = false;
        }
    }

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
    pointLight.shadow.autoUpdate = false;
    pointLight.shadow.needsUpdate = true;
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
    spotLight.shadow.mapSize.width = postQuality === 'low' ? 512 : 1024;
    spotLight.shadow.mapSize.height = postQuality === 'low' ? 512 : 1024;
    spotLight.shadow.autoUpdate = false;
    spotLight.shadow.needsUpdate = true;
    scene.add(spotLight);
    scene.add(spotLight.target);

    // Fog for depth
    scene.fog = new THREE.FogExp2(0x111111, 0.02);

    // Post-Processing
    // Auto-detect low-end GPUs: disable post-processing if texture size is limited.
    // Devices with maxTextureSize < 4096 typically have underpowered GPUs where
    // fullscreen bloom passes would cause significant frame-rate drops.
    // The `?no-post` URL parameter always overrides this check for manual control.
    let composer = null;
    const postPasses = {
        renderPass: null,
        bloomPass: null,
        vignettePass: null,
        outputPass: null,
        postProcessing: null
    };
    if (!disablePost) {
        if (rendererState.usingWebGPU) {
            composer = await createWebGpuPostPipeline(renderer, scene, camera, {
                width: containerWidth,
                height: containerHeight,
                postConfig
            });
            postPasses.postProcessing = composer;
        } else {
            composer = new EffectComposer(renderer);

            const renderPass = new RenderPass(scene, camera);
            composer.addPass(renderPass);
            postPasses.renderPass = renderPass;

            if (postConfig.bloomEnabled) {
                const bloomScale = postQuality === 'low' ? 4 : 2;
                const bloomPass = new UnrealBloomPass(
                    new THREE.Vector2(
                        Math.round(containerWidth / bloomScale),
                        Math.round(containerHeight / bloomScale)
                    ),
                    postQuality === 'low' ? 1.0 : 1.5,
                    postQuality === 'low' ? 0.25 : 0.4,
                    0.85
                );
                bloomPass.threshold = 0.6;
                bloomPass.strength = postQuality === 'low' ? 0.35 : 0.6;
                bloomPass.radius = postQuality === 'low' ? 0.25 : 0.4;
                composer.addPass(bloomPass);
                postPasses.bloomPass = bloomPass;
            }

            // Vignette
            const vignettePass = new ShaderPass(VignetteShader);
            vignettePass.uniforms['offset'].value = 1.2;
            vignettePass.uniforms['darkness'].value = 1.8; // Darker vignette
            composer.addPass(vignettePass);
            postPasses.vignettePass = vignettePass;

            // Output Pass
            const outputPass = new OutputPass();
            composer.addPass(outputPass);
            postPasses.outputPass = outputPass;
        }
    } else if (isLowEndDevice) {
        console.log('Post-processing disabled: low-end GPU detected');
    }

    await preloadSharedTextures(renderer);
    const tavernEnvironment = new TavernEnvironment();
    await tavernEnvironment.load();

    // `fromScene()` renders the source scene into an internal cubemap, so it
    // needs the cubemap PMREM path, not the equirectangular one. On WebGPU,
    // Three.js made this compile step async; awaiting it avoids partially
    // initialized PMREM internals (`renderer.backend.buffers`) during startup.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    try {
        await compilePmremSceneShader(pmremGenerator);
        scene.environment = pmremGenerator.fromScene(tavernEnvironment).texture;
    } catch (error) {
        console.warn('[SceneSetup] Failed to build tavern PMREM environment map; continuing without reflections.', error);
        scene.environment = null;
    } finally {
        pmremGenerator.dispose();
        tavernEnvironment.dispose();
    }

    return { scene, camera, renderer, composer, pointLight, spotLight, postConfig, postPasses, rendererState };
}
