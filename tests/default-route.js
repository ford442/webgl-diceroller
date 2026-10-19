/**
 * The default route must reach `ready` without `?webgl`, and `?overlay` must
 * produce a canvas with real alpha.
 *
 * Headless Chromium on SwiftShader exposes `navigator.gpu` with either no
 * adapter or a software/fallback one. RendererFactory has to pick the classic
 * WebGLRenderer itself in both cases — falling through to a device-less
 * WebGPURenderer lands on Three's WebGL2 TSL backend, which never finishes
 * loading there. Needs no WASM: the tavern reaches `ready` without dice.
 *
 *   npm run build:js:allow-missing-wasm && npm run preview
 *   npm run test:default-route
 */
import { launchPage } from './helpers/browser.js';
import { url } from './helpers/server.js';

const READY_TIMEOUT_MS = 120000;

async function load(page, query) {
    await page.goto(url(query), { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__app?.ready === true, null, {
        timeout: READY_TIMEOUT_MS,
        polling: 250,
    });
}

const { browser, page, errors } = await launchPage();
const consoleLines = [];
page.on('console', (msg) => consoleLines.push(msg.text()));
let failed = 0;
const check = (cond, label) => {
    console.log(`${cond ? 'ok' : 'FAIL'}: ${label}`);
    if (!cond) failed += 1;
};

try {
    // 1. Default route, no ?webgl.
    await load(page, '/?no-post&test&renderer-info');
    const boot = await page.evaluate(() => {
        const state = window.__app.scene?.userData?.rendererState ?? {};
        return {
            rendererType: state.rendererType,
            fallbackReason: state.fallbackReason ?? null,
            contextProfile: state.contextProfile,
            contextProfileReason: state.contextProfileReason,
            isSoftwareRenderer: state.isSoftwareRenderer,
            adapterDescription: state.adapterDescription ?? null,
            sampleCount: state.sampleCount ?? null,
            isWebGLRenderer: /** @type {any} */ (window.__app.renderer)?.isWebGLRenderer === true,
        };
    });
    console.log('default route:', JSON.stringify(boot));
    check(true, 'default route (no ?webgl) reached window.__app.ready');
    check(
        boot.rendererType === 'webgpu' || boot.isWebGLRenderer,
        'WebGL fallback is the classic WebGLRenderer'
    );
    check(
        !consoleLines.some((line) => /running under WebGL2 backend/i.test(line)),
        "never lands on Three's WebGL2 TSL backend"
    );
    check(typeof boot.contextProfile === 'string', 'rendererState reports its context profile');

    // 2. ?overlay → alpha in the drawing buffer, transparent clear, no backdrop.
    consoleLines.length = 0;
    await load(page, '/?overlay&webgl&test');
    const overlay = await page.evaluate(() => {
        const app = window.__app;
        const renderer = /** @type {any} */ (app.renderer);
        const gl = /** @type {WebGL2RenderingContext} */ (renderer.getContext());
        // Render an empty scene and read it back in the same task, before the
        // compositor can swap (preserveDrawingBuffer stays false).
        const THREE_Scene = /** @type {any} */ (app.scene.constructor);
        renderer.setRenderTarget(null);
        renderer.render(new THREE_Scene(), app.camera);
        const px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return {
            contextAlpha: gl.getContextAttributes()?.alpha ?? null,
            clearAlpha: renderer.getClearAlpha(),
            background: app.scene.background === null ? null : 'set',
            contextProfile: app.scene.userData?.rendererState?.contextProfile,
            shadows: renderer.shadowMap.enabled,
            pixelAlpha: px[3],
        };
    });
    console.log('overlay:', JSON.stringify(overlay));
    check(overlay.contextProfile === 'overlay', '?overlay selects the overlay profile');
    check(overlay.contextAlpha === true, '?overlay context is created with alpha');
    check(overlay.clearAlpha === 0 && overlay.background === null, '?overlay clears transparent');
    check(overlay.pixelAlpha === 0, '?overlay empty frame reads back alpha 0');
    check(overlay.shadows === false, '?overlay disables shadows');
} catch (err) {
    console.error('FAILURE:', err.message);
    console.error(consoleLines.slice(-20).join('\n'));
    failed += 1;
} finally {
    await browser.close();
}

if (errors.length) console.log(`(${errors.length} console error(s) during the run)`);
process.exit(failed > 0 ? 1 : 0);
