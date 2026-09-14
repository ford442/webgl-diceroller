// Visual / smoke check for god rays under both renderers.
// Boots the vite dev server, loads ?webgl and ?webgpu, captures console
// errors and the active backend, and writes a screenshot for each.
//
// CPU-only runners (GitHub Actions) cannot finish a WebGPU load: the WebGL2
// TSL backend throws `Cannot read properties of undefined (reading 'buffers')`
// under SwiftShader and the page never becomes screenshot-able. Set
// DICE_CI_NO_WEBGPU=1 (CI does) to report that profile as skipped instead of
// failing the run; locally, where a GPU exists, it stays a hard requirement.
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { startDev } from '../tests/helpers/server.js';
import { capturePng } from '../tests/helpers/browser.js';

// Same software-rasteriser flags the other browser harnesses use (see
// tests/helpers/browser.js), plus the WebGPU opt-ins. Without
// --enable-unsafe-swiftshader the WebGL2 context comes up but never presents a
// frame, and page.screenshot() hangs until its timeout.
const CHROME_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
];

const PORT = 5193;
const SKIP_WEBGPU = process.env.DICE_CI_NO_WEBGPU === '1';
const GOTO_TIMEOUT_MS = 60000;
const SETTLE_MS = 6000;

async function probe(browser, base, query, file) {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const errors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    try {
        await page.goto(`${base}/${query}&test`, {
            waitUntil: 'load',
            timeout: GOTO_TIMEOUT_MS,
        });
        await sleep(SETTLE_MS); // let renderer init + a few animation frames run

        const info = await page
            .evaluate(() => {
                const app = window.__app;
                const scene = app?.scene;
                const stats = app?.stats;
                const post = app?.postConfig;
                return {
                    backend:
                        /** @type {{ post?: { rendererType?: string } } | null | undefined} */ (
                            stats
                        )?.post?.rendererType ??
                        /** @type {{ rendererType?: string } | undefined} */ (
                            scene?.userData?.rendererState
                        )?.rendererType ??
                        'unknown',
                    godRays: post?.godRaysEnabled ?? null,
                    hasFactory: Boolean(scene?.userData?.godRayMaterialFactory),
                };
            })
            .catch(() => ({ backend: 'unknown', godRays: null, hasFactory: false }));

        await capturePng(page, file);
        return { ok: true, ...info, errors };
    } catch (error) {
        return { ok: false, reason: error.message, errors };
    } finally {
        await page.close().catch(() => {});
    }
}

const vite = await startDev({ port: PORT });
const browser = await chromium.launch({ args: CHROME_ARGS });
let failed = false;
try {
    const webgl = await probe(browser, vite.base, '?webgl&test', 'godrays-webgl.png');
    console.log('WEBGL :', JSON.stringify(webgl));
    if (!webgl.ok) {
        console.error(`FAIL: the ?webgl profile did not complete — ${webgl.reason}`);
        failed = true;
    }

    if (SKIP_WEBGPU) {
        console.log('WEBGPU: skipped (DICE_CI_NO_WEBGPU=1 — no GPU on this runner)');
    } else {
        const webgpu = await probe(browser, vite.base, '?webgpu&test', 'godrays-webgpu.png');
        console.log('WEBGPU:', JSON.stringify(webgpu));
        if (!webgpu.ok) {
            console.error(
                `FAIL: the ?webgpu profile did not complete — ${webgpu.reason}. ` +
                    'Set DICE_CI_NO_WEBGPU=1 on machines without a GPU.'
            );
            failed = true;
        }
    }
} finally {
    await browser.close().catch(() => {});
    await vite.close();
}

process.exit(failed ? 1 : 0);
