import * as THREE from 'three';
import { createGlslKit } from './graph/ShaderKit.js';
import { GOD_RAY_PARAMS, godRayAlpha } from './GodRayGraph.js';

/**
 * GodRay Shader (WebGL)
 *
 * Volumetric light beam from scrolling noise. The fragment is generated from
 * `GodRayGraph`, which `GodRayNodeMaterial` builds as TSL for WebGPU.
 */

function fragmentShader() {
    const k = createGlslKit({ prefix: 'ray' });
    const alpha = godRayAlpha(k, {
        uv: 'vUv',
        time: 'uTime',
        speed: 'uSpeed',
        noise: 'tNoise',
        opacity: GOD_RAY_PARAMS.opacity,
    });
    return /* glsl */ `
        uniform float uTime;
        uniform sampler2D tNoise;
        uniform vec3 uColor;
        uniform float uSpeed;

        varying vec2 vUv;

        ${k.functionsSource()}

        void main() {
            ${k.takeStatements()}
            gl_FragColor = vec4( uColor, ${alpha} );
        }`;
}

export const GodRayShader = {
    name: 'GodRayShader',

    uniforms: {
        uTime: { value: 0.0 },
        tNoise: { value: null },
        uColor: { value: new THREE.Color(GOD_RAY_PARAMS.color) },
        uSpeed: { value: GOD_RAY_PARAMS.speed },
    },

    vertexShader: /* glsl */ `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,

    fragmentShader: fragmentShader(),
};
