// Visual / smoke check for god rays under both renderers.
// Boots the vite dev server, loads ?webgl and ?webgpu, captures console
// errors and the active backend, and writes a screenshot for each.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const WGPU_ARGS = [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
];

const PORT = 5193;
const BASE = `http://localhost:${PORT}`;

async function startVite() {
    const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (let i = 0; i < 60; i++) {
        await sleep(500);
        try {
            const res = await fetch(`${BASE}/`);
            if (res.ok) return proc;
        } catch { /* not up yet */ }
    }
    proc.kill('SIGKILL');
    throw new Error('vite start timeout');
}

async function probe(browser, query, file) {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
    await sleep(6000); // let renderer init + a few animation frames run

    const info = await page.evaluate(() => ({
        backend: window.__renderStats?.post?.rendererType
            ?? scene?.userData?.rendererState?.rendererType ?? 'unknown',
        godRays: window.postConfig?.godRaysEnabled ?? null,
        hasFactory: Boolean(window.scene?.userData?.godRayMaterialFactory),
    })).catch(() => ({ backend: 'unknown', godRays: null }));

    await page.screenshot({ path: file });
    await page.close();
    return { ...info, errors };
}

const vite = await startVite();
const browser = await chromium.launch({ args: WGPU_ARGS });
try {
    const webgl = await probe(browser, '?webgl', 'godrays-webgl.png');
    const webgpu = await probe(browser, '?webgpu', 'godrays-webgpu.png');
    console.log('WEBGL :', JSON.stringify(webgl));
    console.log('WEBGPU:', JSON.stringify(webgpu));
} finally {
    await browser.close();
    vite.kill('SIGTERM');
}
