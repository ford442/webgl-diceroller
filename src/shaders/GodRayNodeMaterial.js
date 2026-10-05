import { Color, DoubleSide, AdditiveBlending } from 'three';
import { createTslKit } from './graph/ShaderKit.js';
import { GOD_RAY_PARAMS, godRayAlpha } from './GodRayGraph.js';

/**
 * GodRay Node Material (WebGPU / TSL)
 *
 * `WebGPURenderer` cannot consume the raw-GLSL `GodRayShader`, so the beam is
 * built here as TSL — from the same `GodRayGraph` the GLSL is generated from.
 *
 * three/tsl and three/webgpu are loaded lazily so the WebGL path never pays for
 * the node system. Returns a synchronous factory the walls can call inline.
 */
export async function loadGodRayNodeMaterialFactory() {
    const [TSL, WEBGPU] = await Promise.all([import('three/tsl'), import('three/webgpu')]);
    const { Fn, uv, uniform } = TSL;
    const { MeshBasicNodeMaterial } = WEBGPU;
    const k = createTslKit(TSL);

    return function createGodRayNodeMaterial({
        noiseTexture,
        color = new Color(GOD_RAY_PARAMS.color),
        speed = GOD_RAY_PARAMS.speed,
    }) {
        const uTime = uniform(0.0);

        const material = new MeshBasicNodeMaterial();
        material.colorNode = uniform(color);
        const uSpeed = uniform(speed);
        material.opacityNode = Fn(() =>
            godRayAlpha(k, {
                uv: uv(),
                time: uTime,
                speed: uSpeed,
                noise: noiseTexture,
                opacity: GOD_RAY_PARAMS.opacity,
            })
        )();
        material.transparent = true;
        material.depthWrite = false;
        material.side = DoubleSide;
        material.blending = AdditiveBlending;

        return {
            material,
            setTime: (time) => {
                uTime.value = time;
            },
        };
    };
}
