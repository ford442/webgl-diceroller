#!/usr/bin/env node
/**
 * Verify lazy chunks: ?webgl must not fetch three.webgpu; WASM path must not
 * fetch the ammo physics chunk unless ?no-wasm / dual-physics / ?ammo-drag.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}`;

async function startPreview() {
    const proc = spawn(
        'npx',
        ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    for (let i = 0; i < 120; i++) {
        await sleep(500);
        try {
            if ((await fetch(`${BASE}/`)).ok) return proc;
        } catch {
            // retry
        }
    }
    proc.kill('SIGKILL');
    throw new Error('preview server did not start');
}

function scriptRequests(urls, pattern) {
    return urls.filter((u) => pattern.test(u));
}

async function collectScripts(page, path) {
    const urls = [];
    page.on('request', (req) => {
        if (req.resourceType() === 'script') urls.push(req.url());
    });
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    // Tier 0 completes before the full decorative pass; that's enough for renderer
    // and physics lazy chunks to have been requested.
    await page.waitForFunction(
        () => window.sceneReady === true
            || document.getElementById('loading-text')?.textContent?.includes('Error'),
        null,
        { timeout: 240000 }
    );
    await sleep(3000);
    return urls;
}

const preview = await startPreview();
let failed = 0;

try {
    const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });

    // WebGL baseline: no three.webgpu chunk
    {
        const page = await browser.newPage();
        const urls = await collectScripts(page, '/?webgl&no-post&fair-dice&no-wasm');
        const webgpu = scriptRequests(urls, /three\.webgpu/i);
        if (webgpu.length) {
            failed += 1;
            console.error('FAIL: ?webgl fetched three.webgpu:', webgpu);
        } else {
            console.log('ok: ?webgl did not fetch three.webgpu');
        }
        await page.close();
    }

    // WASM authoritative (default when wasm is active): no ammo physics chunk
    {
        const page = await browser.newPage();
        const urls = await collectScripts(page, '/?webgl&no-post&fair-dice');
        const wasmActive = await page.evaluate(() => window.physicsWorld == null);
        const physics = scriptRequests(urls, /\/physics-[^/]+\.js/i);
        if (!wasmActive) {
            console.log('skip: WASM engine inactive in this build — ammo physics chunk expected');
        } else if (physics.length) {
            failed += 1;
            console.error('FAIL: WASM path fetched ammo physics chunk:', physics);
        } else {
            console.log('ok: WASM path did not fetch ammo physics chunk');
        }
        await page.close();
    }

    // Explicit ammo fallback still loads physics
    {
        const page = await browser.newPage();
        const urls = await collectScripts(page, '/?webgl&no-post&fair-dice&no-wasm');
        const physics = scriptRequests(urls, /\/physics-[^/]+\.js/i);
        if (!physics.length) {
            failed += 1;
            console.error('FAIL: ?no-wasm did not fetch ammo physics chunk');
        } else {
            console.log('ok: ?no-wasm fetched ammo physics chunk');
        }
        await page.close();
    }

    await browser.close();
} finally {
    preview.kill('SIGTERM');
}

if (failed > 0) {
    console.error(`\n${failed} bundle-loading check(s) failed`);
    process.exit(1);
}

console.log('\nAll bundle-loading checks passed.');
