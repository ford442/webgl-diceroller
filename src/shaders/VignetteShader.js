import { createGlslKit } from './graph/ShaderKit.js';
import { VIGNETTE_PARAMS, vignette } from './PostStackParams.js';

/**
 * Vignette Shader (WebGL `ShaderPass`)
 *
 * Darkens the corners of the screen. The fragment is generated from the
 * `vignette` graph the WebGPU post stack builds as TSL, and the defaults are
 * `VIGNETTE_PARAMS`.
 */

function fragmentShader() {
    const k = createGlslKit({ prefix: 'vig' });
    const color = k.variable('vec4', k.sample('tDiffuse', 'vUv'));
    const result = vignette(k, { color, uv: 'vUv', offset: 'offset', darkness: 'darkness' });
    return /* glsl */ `
		uniform float offset;
		uniform float darkness;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {
			${k.takeStatements()}
			gl_FragColor = ${result};
		}`;
}

export const VignetteShader = {
    name: 'VignetteShader',

    uniforms: {
        tDiffuse: { value: null },
        offset: { value: VIGNETTE_PARAMS.offset },
        darkness: { value: VIGNETTE_PARAMS.darkness },
    },

    vertexShader: /* glsl */ `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

    fragmentShader: fragmentShader(),
};
