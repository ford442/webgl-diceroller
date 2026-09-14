const { chromium } = require('playwright');
const fs = require('node:fs');

const DEFAULT_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
];

// Launches headless Chromium with the swiftshader flags these verify scripts
// need, and wires up console/page error collection into a shared `errors`
// array (mutated in place as events arrive, readable at any point).
async function launchPage(opts = {}) {
    const browser = await chromium.launch({
        headless: opts.headless ?? true,
        args: opts.args ?? DEFAULT_ARGS,
    });
    // `browser.newPage()` creates an implicit context, which AxeBuilder
    // rejects ("Please use browser.newContext()"). Callers that inject
    // axe-core pass `context: true`.
    const context = opts.context ? await browser.newContext() : null;
    const page = context ? await context.newPage() : await browser.newPage();
    const errors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
            if (opts.logConsole !== false) console.log(`[BROWSER ERROR] ${msg.text()}`);
        }
    });
    page.on('pageerror', (err) => {
        errors.push(err.message);
        if (opts.logConsole !== false) console.log(`[PAGE ERROR] ${err.message}`);
    });
    // Chromium's console message for a failed fetch is just "Failed to load
    // resource: ... 404", with no URL — which turns a missing artifact into an
    // unfalsifiable test failure. Log the URL alongside it. Not pushed into
    // `errors`: the console message already counts once.
    page.on('response', (res) => {
        if (res.status() >= 400 && opts.logConsole !== false) {
            console.log(`[HTTP ${res.status()}] ${res.url()}`);
        }
    });
    return { browser, page, errors };
}

// Runs `fn(page, errors)`, always closes the browser, and exits the process
// with 0/1 based on the boolean it returns — the common tail of every script.
async function runTest(fn, opts = {}) {
    const { browser, page, errors } = await launchPage(opts);
    try {
        const pass = await fn(page, errors);
        process.exit(pass ? 0 : 1);
    } catch (e) {
        console.error('FAILURE:', e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

// Screenshot a live WebGL/WebGPU page without hanging.
//
// page.screenshot() waits for the compositor to go idle, which never happens
// while a 60 fps SwiftShader rAF loop is redrawing — the call just burns its
// timeout. Stopping the loop, rendering one last frame, and grabbing the
// surface over CDP captures the same pixels and returns immediately.
async function capturePng(page, file) {
    await page
        .evaluate(() => {
            const app = window.__app;
            const r = app?.renderer;
            if (!r) return;
            r.setAnimationLoop(null);
            if (app?.scene && app?.camera) r.render(app.scene, app.camera);
        })
        .catch(() => {});

    const session = await page.context().newCDPSession(page);
    try {
        const { data } = await session.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false,
        });
        try {
            fs.unlinkSync(file);
        } catch {
            /* no prior file */
        }
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
    } finally {
        await session.detach().catch(() => {});
    }
}

module.exports = { launchPage, runTest, capturePng, DEFAULT_ARGS };
