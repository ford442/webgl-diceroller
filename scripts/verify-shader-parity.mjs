#!/usr/bin/env node
// Shader parity: the die surface, the god-ray beam and the vignette are each
// one graph (src/shaders/graph/ShaderKit.js) built as GLSL for WebGLRenderer
// and as TSL for WebGPURenderer. This renders the same fixed scene — a grid of
// die descriptors that exercises every marking style, every inclusion type,
// baked vs atlas glyphs and both draw groups, plus a beam and a vignette card —
// on both renderers and diffs the pixels.
//
//   WebGL   must compile without shader errors and render.        [REQUIRED]
//   WebGPU  must render and match WebGL within tolerance.          [REQUIRED locally]
//           Skipped when DICE_CI_NO_WEBGPU=1 (no GPU on the runners).
//
// Needs no WASM: it loads the dice hulls and materials directly, not the app.
// Writes shader-parity-{webgl,webgpu,diff}.png to the cwd.
//
// Usage: npm run verify:shader-parity
import { chromium } from 'playwright';
import { writeFile, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { startDev } from '../tests/helpers/server.js';

const PORT = 5196;
const SKIP_WEBGPU = process.env.DICE_CI_NO_WEBGPU === '1';
/** Per-channel difference below which a pixel counts as matching. */
const TOLERANCE = 24;
/**
 * Fraction of pixels allowed to differ beyond TOLERANCE. What remains after
 * the graphs are shared is rasterisation: glyph outlines (fwidth) and
 * silhouettes land a pixel apart between backends.
 */
const MAX_DIFF_RATIO = 0.01;

const TEST_MODULE = new URL('../src/__shader_parity_probe.js', import.meta.url);
const TEST_PAGE = new URL('../__shader_parity_probe.html', import.meta.url);

const PROBE_SRC = `
import * as THREE from 'three';
import { loadDiceModels, ensureDieTemplate } from './dice/DiceModels.js';
import { createDefaultEntry } from './core-engine/dice/DiceSetFormat.js';
import { createDiceFaceMarkingMaterial } from './dice/DiceFaceMarkingMaterial.js';
import { loadDiceFaceMarkingNodeMaterialFactory } from './dice/DiceFaceMarkingNodeMaterial.js';
import { GodRayShader } from './shaders/GodRayShader.js';
import { loadGodRayNodeMaterialFactory } from './shaders/GodRayNodeMaterial.js';
import { VignetteShader } from './shaders/VignetteShader.js';
import { VIGNETTE_PARAMS, vignette } from './shaders/PostStackParams.js';
import { createTslKit } from './shaders/graph/ShaderKit.js';

const W = 512;
const H = 384;

function entry(key, edit) {
    const e = createDefaultEntry(key);
    edit?.(e);
    return { key, entry: e };
}

// Baked + atlas, both draw groups, all three styles, all four inclusions.
const VARIANTS = [
    entry('d20'),
    entry('d20', (e) => {
        e.numbering.start = 0;
        e.faces.style = 'engraved';
        e.body.inclusion = { type: 'swirl', color: '#ff00aa', intensity: 0.8 };
    }),
    entry('d6', (e) => {
        e.faces.glyphs = 'pips';
        e.faces.style = 'painted';
        e.body.inclusion = { type: 'galaxy', color: '#88ccff', intensity: 0.9 };
    }),
    entry('d10', (e) => {
        e.numbering.start = 0;
        e.body.preset = 'glow';
        e.body.inclusion = { type: 'glitter', color: '#ffffff', intensity: 1 };
    }),
    entry('d8', (e) => {
        e.faces.underlineSixNine = true;
        e.body.preset = 'metal';
        e.faces.style = 'engraved';
        e.faces.depth = 0.8;
    }),
    entry('d12', (e) => {
        e.faces.font = 'serif';
        e.body.preset = 'obsidian';
        e.faces.depth = 0.6;
    }),
    entry('d4', (e) => {
        e.numbering.start = 2;
        e.body.preset = 'bone';
        e.faces.style = 'engraved';
    }),
    entry('d6', (e) => {
        e.faces.style = 'engraved';
        e.faces.depth = 1;
        e.body.inclusion = { type: 'swirl', color: '#00ffaa', intensity: 0.5 };
    }),
];

function noiseTexture() {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    let s = 12345;
    for (let i = 0; i < size * size; i++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        const n = Math.floor((s / 4294967296) * 255);
        data.set([n, n, n, 255], i * 4);
    }
    const texture = new THREE.DataTexture(data, size, size);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
}

async function backendFor(name) {
    if (name === 'webgpu') {
        if (!navigator.gpu) return { reason: 'navigator.gpu unavailable' };
        const WEBGPU = await import('three/webgpu');
        const TSL = await import('three/tsl');
        const renderer = new WEBGPU.WebGPURenderer({ antialias: false });
        await renderer.init();
        if (!renderer.backend?.isWebGPUBackend) return { reason: 'WebGPURenderer fell back to WebGL2' };
        const dice = await loadDiceFaceMarkingNodeMaterialFactory();
        const rays = await loadGodRayNodeMaterialFactory();
        const k = createTslKit(TSL);
        return {
            renderer,
            renderTarget: new THREE.RenderTarget(W, H),
            dice: (e, template) => dice(e, template, { highQuality: false }),
            godRay(noise) {
                const built = rays({ noiseTexture: noise });
                built.setTime(3.7);
                return built.material;
            },
            vignette() {
                const material = new WEBGPU.MeshBasicNodeMaterial();
                material.colorNode = TSL.Fn(() =>
                    vignette(k, {
                        color: TSL.vec4(1, 0.8, 0.6, 1),
                        uv: TSL.uv(),
                        offset: TSL.uniform(VIGNETTE_PARAMS.offset),
                        darkness: TSL.uniform(VIGNETTE_PARAMS.darkness),
                    })
                )();
                return material;
            },
            async draw(scene, camera) {
                renderer.setRenderTarget(this.renderTarget);
                renderer.render(scene, camera);
                return renderer.readRenderTargetPixelsAsync(this.renderTarget, 0, 0, W, H);
            },
        };
    }

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.debug.checkShaderErrors = true;
    return {
        renderer,
        renderTarget: new THREE.WebGLRenderTarget(W, H),
        dice: (e, template) => createDiceFaceMarkingMaterial(e, template, { highQuality: false }),
        godRay(noise) {
            const uniforms = THREE.UniformsUtils.clone(GodRayShader.uniforms);
            uniforms.tNoise.value = noise;
            uniforms.uTime.value = 3.7;
            return new THREE.ShaderMaterial({
                uniforms,
                vertexShader: GodRayShader.vertexShader,
                fragmentShader: GodRayShader.fragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
        },
        vignette() {
            const uniforms = THREE.UniformsUtils.clone(VignetteShader.uniforms);
            const white = new THREE.DataTexture(new Uint8Array([255, 204, 153, 255]), 1, 1);
            white.needsUpdate = true;
            uniforms.tDiffuse.value = white;
            return new THREE.ShaderMaterial({
                uniforms,
                vertexShader: VignetteShader.vertexShader,
                fragmentShader: VignetteShader.fragmentShader,
            });
        },
        async draw(scene, camera) {
            renderer.setRenderTarget(this.renderTarget);
            renderer.render(scene, camera);
            const pixels = new Uint8Array(W * H * 4);
            renderer.readRenderTargetPixels(this.renderTarget, 0, 0, W, H, pixels);
            return pixels;
        },
    };
}

export async function run(name) {
    const backend = await backendFor(name);
    if (!backend.renderer) return { ok: false, skipped: true, reason: backend.reason };
    await loadDiceModels();
    backend.renderer.setPixelRatio(1);
    backend.renderer.setSize(W, H);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202020);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.5);
    key.position.set(3, 5, 8);
    scene.add(key);
    const warm = new THREE.PointLight(0xff9933, 30, 0);
    warm.position.set(-4, 2, 5);
    scene.add(warm);

    VARIANTS.forEach(({ key: dieKey, entry: e }, i) => {
        const template = ensureDieTemplate(dieKey);
        if (!template) throw new Error('die hull did not load: ' + dieKey);
        const { materials } = backend.dice(e, template);
        const die = template.clone();
        die.material = template.geometry.groups.length >= 2 && materials.length >= 2 ? materials : materials[0];
        const box = new THREE.Box3().setFromBufferAttribute(template.geometry.attributes.position);
        die.scale.setScalar(2.7 / box.getSize(new THREE.Vector3()).length());
        die.position.set(-4.5 + (i % 4) * 3, i < 4 ? 3 : 0.4, 0);
        die.rotation.set(0.6 + i * 0.37, 0.3 + i * 0.71, 0.1 * i);
        scene.add(die);
    });

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.2, 3, 32, 1, true), backend.godRay(noiseTexture()));
    beam.position.set(-4, -2.9, 0);
    beam.rotation.z = Math.PI / 2 + 0.3;
    scene.add(beam);

    const card = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), backend.vignette());
    card.position.set(2.5, -2.9, 0);
    scene.add(card);

    const camera = new THREE.OrthographicCamera(-7.5, 7.5, 4.6, -4.6, 0.1, 100);
    camera.position.set(0, 0, 10);

    const pixels = await backend.draw(scene, camera);
    const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return { ok: true, width: W, height: H, pixels: btoa(binary) };
}
`;

/** WebGL reads render-target rows bottom-up, WebGPU top-down; normalise to top-down. */
function toImage({ width, height, pixels }, bottomUp) {
    const raw = Buffer.from(pixels, 'base64');
    if (!bottomUp) return { width, height, data: raw };
    const row = width * 4;
    const flipped = Buffer.alloc(raw.length);
    for (let y = 0; y < height; y++)
        raw.copy(flipped, (height - 1 - y) * row, y * row, (y + 1) * row);
    return { width, height, data: flipped };
}

function diff(a, b) {
    const out = Buffer.alloc(a.data.length);
    let differing = 0;
    let max = 0;
    for (let i = 0; i < a.width * a.height; i++) {
        let d = 0;
        for (let c = 0; c < 3; c++)
            d = Math.max(d, Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]));
        max = Math.max(max, d);
        if (d > TOLERANCE) differing++;
        const v = Math.min(255, d * 4);
        out.set([v, v, v, 255], i * 4);
    }
    return { ratio: differing / (a.width * a.height), max, image: { ...a, data: out } };
}

async function writePng(image, file) {
    await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
        .png()
        .toFile(file);
}

await writeFile(TEST_MODULE, PROBE_SRC);
await writeFile(TEST_PAGE, '<!doctype html><html><body></body></html>\n');
const vite = await startDev({ port: PORT });
const browser = await chromium.launch({
    args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--ignore-gpu-blocklist',
    ],
});

const failures = [];
const images = {};
try {
    for (const name of SKIP_WEBGPU ? ['webgl'] : ['webgl', 'webgpu']) {
        const page = await browser.newPage();
        const errors = [];
        page.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text().slice(0, 2000));
        });
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        await page.goto(`${vite.base}/__shader_parity_probe.html`);
        const result = await page.evaluate(async (backend) => {
            try {
                return await (await import('/src/__shader_parity_probe.js')).run(backend);
            } catch (e) {
                return { ok: false, reason: String((e && e.stack) || e) };
            }
        }, name);
        await page.close();

        if (!result.ok) {
            failures.push(`${name}: ${result.reason}`);
        } else if (errors.length) {
            failures.push(`${name}: console errors\n  ${errors.join('\n  ')}`);
        } else {
            images[name] = toImage(result, name === 'webgl');
            await writePng(images[name], `shader-parity-${name}.png`);
            console.log(`[shader-parity] ${name}: rendered`);
        }
    }

    if (SKIP_WEBGPU) {
        console.log('[shader-parity] webgpu: skipped (DICE_CI_NO_WEBGPU=1)');
    } else if (images.webgl && images.webgpu) {
        const result = diff(images.webgl, images.webgpu);
        await writePng(result.image, 'shader-parity-diff.png');
        const summary = `${(result.ratio * 100).toFixed(2)}% of pixels differ by >${TOLERANCE} (max ${result.max})`;
        if (result.ratio > MAX_DIFF_RATIO) {
            failures.push(`webgl vs webgpu: ${summary}; allowed ${MAX_DIFF_RATIO * 100}%`);
        } else {
            console.log(`[shader-parity] webgl vs webgpu: ${summary}`);
        }
    }
} finally {
    await browser.close();
    await vite.close();
    await rm(TEST_MODULE, { force: true });
    await rm(TEST_PAGE, { force: true });
}

if (failures.length) {
    console.error(`[shader-parity] FAILED\n${failures.map((f) => `- ${f}`).join('\n')}`);
    process.exit(1);
}
console.log('[shader-parity] OK');
