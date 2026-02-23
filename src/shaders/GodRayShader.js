import * as THREE from 'three';

/**
 * GodRay Shader
 * Volumetric light beam effect using scrolling noise.
 */

export const GodRayShader = {

    name: 'GodRayShader',

    uniforms: {
        'uTime': { value: 0.0 },
        'tNoise': { value: null },
        'uColor': { value: new THREE.Color(0xddeeff) }, // Cool blue-white
        'uSpeed': { value: 0.1 }
    },

    vertexShader: /* glsl */`
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,

    fragmentShader: /* glsl */`
        uniform float uTime;
        uniform sampler2D tNoise;
        uniform vec3 uColor;
        uniform float uSpeed;

        varying vec2 vUv;

        void main() {
            // Scrolling UVs for noise
            // We scroll Y downwards (from window source)
            // If Y=1 is top, and we scroll down, we subtract time?
            vec2 scrollUv = vUv;
            scrollUv.y += uTime * uSpeed; // Scroll up? Texture coordinates...
            // If we want texture to move down (from 1 to 0), we increase V?
            // Or shift V.

            // Sample noise
            float noise = texture2D( tNoise, scrollUv ).r;

            // Second layer for complexity
            float noise2 = texture2D( tNoise, scrollUv * 0.5 - vec2(0.0, uTime * uSpeed * 0.5) ).r;

            float dust = mix(noise, noise2, 0.5);

            // Beam Shape Mask
            // Fade out at bottom (vUv.y near 0)
            float beamFade = smoothstep(0.0, 0.4, vUv.y);

            // Soft edges left/right (X around cylinder)
            // Cylinder UV.x is 0..1 around.
            // We want it to look like a beam, not a solid tube.
            // The noise breaks it up, but maybe we want it uniform around?
            // Yes, uniform is fine for a volumetric cone.

            // Intensity
            float intensity = (dust * 0.8 + 0.2) * beamFade;

            // Increase brightness near source
            intensity += pow(vUv.y, 2.0) * 0.3;

            gl_FragColor = vec4( uColor, intensity * 0.4 ); // Low alpha for subtle effect
        }`
};
