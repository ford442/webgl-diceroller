import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { VignetteShader } from '../shaders/VignetteShader.js';
import { TavernEnvironment } from '../environment/TavernEnvironment.js';
import { createRenderer } from './RendererFactory.js';
import { preloadSharedTextures } from './TexturePipeline.js';
import { CAMERA_EYE_Y, CAMERA_LOOK_AT_Y, CAMERA_START_Z, TABLE_SURFACE_Y } from './SceneMetrics.js';

const VIGNETTE_OFFSET = 1.0;
const VIGNETTE_DARKNESS = 1.0;

async function createWebGpuPostPipeline(renderer, scene, camera, { width, height, postConfig }) {
    const [
        { PostProcessing },
        { pass, uniform, float, vec2, vec3, vec4, mix, Fn, screenUV },
        { bloom },
        { chromaticAberration },
        { fxaa }
    ] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
        import('three/addons/tsl/display/BloomNode.js'),
        import('three/addons/tsl/display/ChromaticAberrationNode.js'),
        import('three/addons/tsl/display/FXAANode.js')
    ]);

    const postProcessing = new PostProcessing(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setSize(width, height);

    const sceneColorNode = scenePass.getTextureNode('output');
    let colorNode = sceneColorNode;
    let bloomNode = null;

    if (postConfig.bloomEnabled) {
        bloomNode = bloom(
            sceneColorNode,
            postConfig.quality === 'low' ? 0.35 : 0.6,
            postConfig.quality === 'low' ? 0.25 : 0.4,
            0.6
        );
        colorNode = sceneColorNode.add(bloomNode);
    }

    const vignetteOffset = uniform(VIGNETTE_OFFSET);
    const vignetteDarkness = uniform(VIGNETTE_DARKNESS);
    const vignetteNode = Fn(() => {
        const vignetteUv = screenUV.sub(vec2(0.5, 0.5)).mul(vignetteOffset);
        const vignetteColor = vec3(float(1.0).sub(vignetteDarkness));
        return vec4(
            mix(colorNode.rgb, vignetteColor, vignetteUv.dot(vignetteUv)),
            colorNode.a
        );
    })();

    let outputNode = vignetteNode;

    if (postConfig.quality === 'high') {
        outputNode = chromaticAberration(outputNode, 0.2, vec2(0.5, 0.5), 1.08);
    }

    if (postConfig.fxaaEnabled) {
        outputNode = fxaa(outputNode);
    }

    postProcessing.outputNode = outputNode;

    return {
        type: 'webgpu-post',
        render() {
            postProcessing.render();
        },
        setSize(nextWidth, nextHeight) {
            scenePass.setSize(nextWidth, nextHeight);
            // BloomNode resizes itself in updateBefore() once blur materials exist.
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

    // Renderer setup — pixel ratio, MSAA vs post FXAA, and power preference
    // are resolved inside RendererFactory from device DPR and URL flags.
    const rendererState = await createRenderer(container);
    const renderer = rendererState.renderer;
    container.appendChild(renderer.domElement);
    scene.userData.renderer = renderer;
    scene.userData.rendererState = rendererState;
    scene.userData.rendererType = rendererState.rendererType;

    const params = new URLSearchParams(window.location.search);
    const hardwareConcurrency = navigator.hardwareConcurrency || 4;
    const hasWebGpu = rendererState.usingWebGPU || Boolean(navigator.gpu);
    const maxTextureSize = renderer.capabilities?.maxTextureSize ?? 4096;
    const isSoftwareRenderer = rendererState.isSoftwareRenderer;
    const isLowEndDevice = isSoftwareRenderer || maxTextureSize < 4096 || hardwareConcurrency <= 4 || !hasWebGpu;
    const forceLowPost = params.has('low-post');
    const disablePost = params.has('no-post');
    const disableBloom = params.has('no-bloom');
    const disableGodRays = params.has('no-godrays');
    const postQuality = disablePost ? 'off' : ((isLowEndDevice || forceLowPost) ? 'low' : 'high');
    const postConfig = {
        quality: postQuality,
        bloomEnabled: !disablePost && !disableBloom,
        godRaysEnabled: !disableGodRays,
        fxaaEnabled: rendererState.usePostAA && !disablePost,
        lowEndDetected: isLowEndDevice,
        softwareRenderer: isSoftwareRenderer,
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

    // Lights — bias toward readable dice faces on the velvet zone.
    const ambientIntensity = rendererState.usingWebGPU ? 0.16 : 0.09;
    const ambientLight = new THREE.AmbientLight(0xfff8f0, ambientIntensity);
    scene.add(ambientLight);

    const hemisphereLight = new THREE.HemisphereLight(0xc8d4ff, 0x3a2418, rendererState.usingWebGPU ? 0.38 : 0.24);
    scene.add(hemisphereLight);

    const diceFillLight = new THREE.DirectionalLight(0xfff0dd, 0.32);
    diceFillLight.position.set(2, 16, 10);
    diceFillLight.target.position.set(0, TABLE_SURFACE_Y, 0);
    diceFillLight.castShadow = false;
    scene.add(diceFillLight);
    scene.add(diceFillLight.target);

    // Warm PointLight (Candle) - Key Light
    // Initial setup, position will be updated by clutter
    // Deeper orange/red for a warmer, cozier feel (0xff9933)
    const pointLight = new THREE.PointLight(0xff9933, 2.2, 22);
    pointLight.position.set(3, 6, 3); // Default if no candle
    pointLight.castShadow = true;
    pointLight.shadow.bias = -0.001;
    pointLight.shadow.normalBias = 0.02;
    pointLight.shadow.mapSize.width = 512;
    pointLight.shadow.mapSize.height = 512;
    pointLight.shadow.radius = 6;
    pointLight.shadow.camera.near = 0.1;
    pointLight.shadow.camera.far = 25;
    pointLight.shadow.autoUpdate = false;
    pointLight.shadow.needsUpdate = true;
    scene.add(pointLight);

    // Cool SpotLight (Moonlight) - Shining through the window
    // More blue, lower intensity for contrast (0x4444dd)
    const spotLight = new THREE.SpotLight(0x4444dd, 3.5);
    spotLight.position.set(-45, 15, -5); // Outside the window
    spotLight.target.position.set(0, TABLE_SURFACE_Y, 0); // Aim at table center
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
    scene.fog = new THREE.FogExp2(0x111111, 0.015);

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
            vignettePass.uniforms['offset'].value = VIGNETTE_OFFSET;
            vignettePass.uniforms['darkness'].value = VIGNETTE_DARKNESS;
            composer.addPass(vignettePass);
            postPasses.vignettePass = vignettePass;

            if (postConfig.fxaaEnabled) {
                const fxaaPass = new FXAAPass();
                fxaaPass.setSize(containerWidth, containerHeight);
                composer.addPass(fxaaPass);
                postPasses.fxaaPass = fxaaPass;
            }

            // Output Pass
            const outputPass = new OutputPass();
            composer.addPass(outputPass);
            postPasses.outputPass = outputPass;
        }
    } else if (isLowEndDevice) {
        const reason = isSoftwareRenderer ? 'software WebGL rasterizer' : 'low-end GPU';
        console.log(`Post-processing tuned for ${reason}`);
    }

    await preloadSharedTextures(renderer);

    // Three r181 still trips an internal WebGPU PMREMGenerator bug when
    // `fromScene()` is used during startup, which crashes the bootstrap path and
    // can even lose the device. Keep the richer tavern PMREM on WebGL, and let
    // WebGPU fall back to direct lighting only until upstream support stabilizes.
    if (rendererState.usingWebGPU) {
        console.warn('[SceneSetup] Skipping tavern PMREM environment on WebGPU due to a Three.js renderer bug.');
        scene.environment = null;
    } else {
        const tavernEnvironment = new TavernEnvironment();
        await tavernEnvironment.load();

        // `fromScene()` renders the source scene into an internal cubemap, so it
        // needs the cubemap PMREM path, not the equirectangular one.
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
    }

    return { scene, camera, renderer, composer, pointLight, spotLight, postConfig, postPasses, rendererState };
}
