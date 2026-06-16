// Visual + perf regression check: compare ?webgl vs ?webgpu under a controlled
// camera. Boots the vite dev server, loads each renderer, fixes the camera to a
// deterministic pose, captures a screenshot plus renderer/scene/draw-call info,
// and reports parity (renderer identity, object counts) and rough frame timing.
//
// Usage:  node scripts/render-regression.mjs
// Output: render-regression-{webgl,webgpu}.png + a JSON summary on stdout.
//
// Note: a full scene needs the WASM physics artifacts (npm run build:wasm). The
// script still captures renderer/visual info if the scene reaches "ready"; it
// waits on window.scene and degrades to whatever state it can read.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 5195;
const BASE = `http://localhost:${PORT}`;
const WGPU_ARGS = [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--ignore-gpu-blocklist',
];

// Deterministic camera pose so both renderers frame the identical view.
const CAMERA = { pos: [0, 6, 14], lookAt: [0, 0, 0] };

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

async function probe(browser, query, file) {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
    // Wait for the scene object; tolerate physics-blocked envs by capping the wait.
    await page.waitForFunction(() => window.scene !== undefined, { timeout: 30000 })
        .catch(() => {});
    await sleep(4000); // let the renderer settle + a few frames run

    // Pin the camera to the controlled pose and render a couple of frames.
    await page.evaluate(({ pos, lookAt }) => {
        if (!window.camera) return;
        window.camera.position.set(pos[0], pos[1], pos[2]);
        window.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
        window.camera.updateMatrixWorld(true);
    }, CAMERA).catch(() => {});
    await sleep(800);

    const info = await page.evaluate(() => {
        const r = window.renderer;
        const render = r?.info?.render ?? {};
        const memory = r?.info?.memory ?? {};
        let objects = 0;
        window.scene?.traverse?.(() => { objects += 1; });
        return {
            rendererType: window.rendererType ?? null,
            usingWebGPU: window.usingWebGPU ?? null,
            fallbackReason: window.rendererFallbackReason ?? null,
            sceneReady: window.sceneReady ?? false,
            sceneChildren: window.scene?.children?.length ?? null,
            sceneObjects: objects || null,
            drawCalls: render.calls ?? render.drawCalls ?? null,
            triangles: render.triangles ?? null,
            geometries: memory.geometries ?? null,
            textures: memory.textures ?? null,
            frameMs: window.__renderStats?.timings?.render ?? null,
        };
    }).catch((e) => ({ error: String(e) }));

    await page.screenshot({ path: file });
    await page.close();
    return { ...info, errors };
}

const vite = await startVite();
const browser = await chromium.launch({ args: WGPU_ARGS });
try {
    const webgl = await probe(browser, '?webgl', 'render-regression-webgl.png');
    const webgpu = await probe(browser, '?webgpu', 'render-regression-webgpu.png');

    // Parity checks. Object counts should match closely between renderers (same
    // scene graph); renderer identity should be as forced.
    const checks = [];
    checks.push(['webgl is webgl', webgl.rendererType === 'webgl']);
    checks.push(['webgpu is webgpu (or documented fallback)',
        webgpu.rendererType === 'webgpu' || Boolean(webgpu.fallbackReason)]);
    if (webgl.sceneObjects != null && webgpu.sceneObjects != null) {
        const diff = Math.abs(webgl.sceneObjects - webgpu.sceneObjects);
        checks.push([`scene object counts within 2 (Δ=${diff})`, diff <= 2]);
    }
    checks.push(['no console errors (webgl)', webgl.errors.length === 0]);
    checks.push(['no console errors (webgpu)', webgpu.errors.length === 0]);

    const report = { camera: CAMERA, webgl, webgpu, checks };
    console.log(JSON.stringify(report, null, 2));
    const failed = checks.filter(([, ok]) => !ok);
    if (failed.length) {
        console.error(`\nREGRESSION: ${failed.length} check(s) failed: ` +
            failed.map(([n]) => n).join('; '));
        process.exitCode = 1;
    } else {
        console.log('\nOK: webgl/webgpu parity checks passed.');
    }
} finally {
    await browser.close();
    vite.kill('SIGTERM');
}
