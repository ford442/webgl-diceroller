// Isolated check: does the TSL god-ray NodeMaterial actually compile & render
// under WebGPURenderer? Bypasses the app's physics init (which needs WASM).
// Drops a temporary module under src/ so Vite transforms its bare imports.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, rm } from 'node:fs/promises';

const PORT = 5194;
const BASE = `http://localhost:${PORT}`;
const TEST_MODULE = new URL('../src/__godray_test.js', import.meta.url);
const ARGS = [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
];

const TEST_SRC = `
import * as THREE from 'three';
import { loadGodRayNodeMaterialFactory } from './shaders/GodRayNodeMaterial.js';
export async function run() {
    if (!navigator.gpu) return { ok: false, reason: 'no navigator.gpu' };
    const THREE_WEBGPU = await import('three/webgpu');
    const renderer = new THREE_WEBGPU.WebGPURenderer({ antialias: false });
    renderer.setSize(256, 256);
    await renderer.init();
    const factory = await loadGodRayNodeMaterialFactory();
    const noise = new THREE.DataTexture(new Uint8Array(4 * 64 * 64).fill(128), 64, 64);
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    noise.needsUpdate = true;
    const { material, setTime } = factory({ noiseTexture: noise });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(3, 8, 40, 32, 1, true), material);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 30);
    setTime(1.23);
    await renderer.renderAsync(scene, cam);
    setTime(2.46);
    await renderer.renderAsync(scene, cam);
    return {
        ok: true,
        backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl-fallback',
        hasColorNode: Boolean(material.colorNode),
        hasOpacityNode: Boolean(material.opacityNode),
        transparent: material.transparent,
        additive: material.blending === THREE.AdditiveBlending,
    };
}
`;

async function startVite() {
    const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 60; i++) {
        await sleep(500);
        try { if ((await fetch(`${BASE}/`)).ok) return proc; } catch {}
    }
    proc.kill('SIGKILL');
    throw new Error('vite timeout');
}

await writeFile(TEST_MODULE, TEST_SRC);
console.log('[verify] starting vite...');
const vite = await startVite();
console.log('[verify] vite up, launching browser...');
const browser = await chromium.launch({ args: ARGS });
console.log('[verify] browser launched');
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async () => {
        try {
            const m = await import('/src/__godray_test.js');
            return await m.run();
        } catch (e) { return { ok: false, reason: String(e && e.stack || e) }; }
    });
    console.log('RESULT:', JSON.stringify(result));
    console.log('ERRORS:', JSON.stringify(errors));
} finally {
    await browser.close();
    vite.kill('SIGTERM');
    await rm(TEST_MODULE, { force: true });
}
