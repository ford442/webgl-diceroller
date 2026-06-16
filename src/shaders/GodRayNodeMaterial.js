import { Color, DoubleSide, AdditiveBlending } from 'three';

/**
 * GodRay Node Material (WebGPU / TSL)
 *
 * A TSL NodeMaterial port of GodRayShader.js so the volumetric moonlight beams
 * render under WebGPURenderer, which cannot consume the raw-GLSL ShaderMaterial.
 * The math mirrors GodRayShader's fragment shader exactly:
 *   - two scrolling samples of the noise texture mixed into "dust"
 *   - a soft bottom fade plus a brighter near-source term
 *   - low alpha additive output for a subtle glow
 *
 * three/tsl and three/webgpu are loaded lazily so the WebGL path never pays for
 * the node system. Returns a synchronous factory the walls can call inline.
 */
export async function loadGodRayNodeMaterialFactory() {
    const [TSL, WEBGPU] = await Promise.all([
        import('three/tsl'),
        import('three/webgpu')
    ]);
    const { uv, texture, uniform, vec2, float, mix, smoothstep, pow } = TSL;
    const { MeshBasicNodeMaterial } = WEBGPU;

    return function createGodRayNodeMaterial({ noiseTexture, color = new Color(0xddeeff), speed = 0.1 }) {
        const uTime = uniform(0.0);
        const uSpeed = uniform(speed);
        const uColor = uniform(color);

        const vUv = uv();

        // Scroll the noise upwards from the window source.
        const scrollUv = vec2(vUv.x, vUv.y.add(uTime.mul(uSpeed)));
        const noise = texture(noiseTexture, scrollUv).r;

        // Second, larger/slower layer for cloudy complexity.
        const scrollUv2 = scrollUv.mul(0.5).sub(vec2(float(0.0), uTime.mul(uSpeed).mul(0.5)));
        const noise2 = texture(noiseTexture, scrollUv2).r;

        const dust = mix(noise, noise2, 0.5);

        // Fade out near the bottom of the beam, brighten near the source.
        const beamFade = smoothstep(0.0, 0.4, vUv.y);
        const intensity = dust.mul(0.8).add(0.2).mul(beamFade)
            .add(pow(vUv.y, 2.0).mul(0.3));

        const material = new MeshBasicNodeMaterial();
        material.colorNode = uColor;
        material.opacityNode = intensity.mul(0.4); // Low alpha for subtle effect
        material.transparent = true;
        material.depthWrite = false;
        material.side = DoubleSide;
        material.blending = AdditiveBlending;

        return {
            material,
            setTime: (time) => { uTime.value = time; }
        };
    };
}
