#!/usr/bin/env node
/**
 * Verify lazy chunks: ?webgl must not fetch three.webgpu; the default WASM path
 * must not fetch the ammo physics chunk. `?no-wasm` is the only escape hatch
 * that pulls ammo back in.
 */
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { startPreview } from '../tests/helpers/server.js';

const PORT = 4177;

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
        () =>
            window.__app?.ready === true ||
            document.getElementById('loading-text')?.textContent?.includes('Error'),
        null,
        { timeout: 240000 }
    );
    await sleep(3000);
    return urls;
}

const preview = await startPreview({ port: PORT });
const BASE = preview.base;
let failed = 0;

try {
    const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });

    // WebGL baseline: no three.webgpu chunk
    {
        const page = await browser.newPage();
        const urls = await collectScripts(page, '/?webgl&no-post&fair-dice&test&no-wasm');
        const webgpu = scriptRequests(urls, /three\.webgpu/i);
        if (webgpu.length) {
            failed += 1;
            console.error('FAIL: ?webgl fetched three.webgpu:', webgpu);
        } else {
            console.log('ok: ?webgl did not fetch three.webgpu');
        }
        await page.close();
    }

    // WASM authoritative (default when wasm is active): no ammo physics chunk,
    // and no ammo rigid body behind any die.
    {
        const page = await browser.newPage();
        const urls = await collectScripts(page, '/?webgl&no-post&fair-dice&test');
        const wasmActive = await page.evaluate(() => window.__app?.physicsWorld == null);
        const physics = scriptRequests(urls, /\/physics-[^/]+\.js/i);
        if (!wasmActive) {
            console.log('skip: WASM engine inactive in this build — ammo physics chunk expected');
        } else if (physics.length) {
            failed += 1;
            console.error('FAIL: WASM path fetched ammo physics chunk:', physics);
        } else {
            console.log('ok: WASM path did not fetch ammo physics chunk');
        }

        if (wasmActive) {
            const ammoDiceBodies = await page.evaluate(() => {
                let count = 0;
                window.__app?.scene?.traverse((object) => {
                    if (object.userData?.isDie && object.userData.body != null) count += 1;
                });
                return count;
            });
            if (ammoDiceBodies > 0) {
                failed += 1;
                console.error(`FAIL: WASM path created ${ammoDiceBodies} ammo dice body/bodies`);
            } else {
                console.log('ok: WASM path created no ammo dice bodies');
            }
        }
        await page.close();
    }

    // Explicit ammo fallback still loads physics
    {
        const page = await browser.newPage();
        const urls = await collectScripts(page, '/?webgl&no-post&fair-dice&test&no-wasm');
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
    await preview.close();
}

if (failed > 0) {
    console.error(`\n${failed} bundle-loading check(s) failed`);
    process.exit(1);
}

console.log('\nAll bundle-loading checks passed.');
