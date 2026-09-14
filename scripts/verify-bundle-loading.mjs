#!/usr/bin/env node
/**
 * Verify lazy chunks: ?webgl must not fetch three.webgpu. ammo.js was
 * retired — there is no physics fallback chunk to check for any more.
 * `?no-wasm` now forces WasmPhysicsBridge's no-op stub instead of a
 * different engine, so this also checks that path shows the honest
 * failure banner and spawns no dice, rather than fetching a fallback chunk.
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
    const consoleMessages = [];
    page.on('request', (req) => {
        if (req.resourceType() === 'script') urls.push(req.url());
    });
    page.on('console', (msg) => consoleMessages.push(msg.text()));
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
    return { urls, consoleMessages };
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
        const { urls } = await collectScripts(page, '/?webgl&no-post&fair-dice&test&no-wasm');
        const webgpu = scriptRequests(urls, /three\.webgpu/i);
        if (webgpu.length) {
            failed += 1;
            console.error('FAIL: ?webgl fetched three.webgpu:', webgpu);
        } else {
            console.log('ok: ?webgl did not fetch three.webgpu');
        }
        await page.close();
    }

    // ?no-wasm: no physics fallback chunk exists any more — the app should show
    // the honest failure banner and spawn zero dice, not a different engine.
    {
        const page = await browser.newPage();
        const { urls, consoleMessages } = await collectScripts(
            page,
            '/?webgl&no-post&fair-dice&test&no-wasm'
        );
        const physics = scriptRequests(urls, /\/physics-[^/]+\.js/i);
        if (physics.length) {
            failed += 1;
            console.error(
                'FAIL: ?no-wasm fetched a physics fallback chunk (should not exist):',
                physics
            );
        } else {
            console.log('ok: ?no-wasm fetched no physics fallback chunk');
        }

        const dieCount = await page.evaluate(() => {
            let count = 0;
            window.__app?.scene?.traverse((object) => {
                if (object.userData?.isDie) count += 1;
            });
            return count;
        });
        if (dieCount > 0) {
            failed += 1;
            console.error(`FAIL: ?no-wasm spawned ${dieCount} die/dice with no physics engine`);
        } else {
            console.log('ok: ?no-wasm spawned no dice');
        }

        // The overlay itself fades out and is removed ~3s after
        // showLoadFailure() runs (see PhysicsBootstrap.js), so by the time
        // collectScripts() returns the DOM node is very likely already gone —
        // assert the console warning it logs instead, which is stable.
        const sawFailureBanner = consoleMessages.some((text) =>
            text.includes('Physics engine unavailable')
        );
        if (!sawFailureBanner) {
            failed += 1;
            console.error('FAIL: ?no-wasm did not log the physics-unavailable warning');
        } else {
            console.log('ok: ?no-wasm logged the physics-unavailable warning');
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
