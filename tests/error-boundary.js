/**
 * Error boundary (#383): a failing system is contained, surfaced once, and a
 * failed boot / stale chunk ends in a message rather than a blank or frozen page.
 *
 *   npm run build:js:allow-missing-wasm && npm run preview
 *   npm run test:error-boundary
 *
 * Needs no WASM: the tavern reaches `ready` without dice.
 */
import { launchPage } from './helpers/browser.js';
import { url } from './helpers/server.js';

const READY_TIMEOUT_MS = 120000;
let failed = 0;
const check = (cond, label, extra = '') => {
    console.log(`${cond ? 'ok' : 'FAIL'}: ${label}${!cond && extra ? `  (${extra})` : ''}`);
    if (!cond) failed += 1;
};

async function ready(page, query) {
    await page.goto(url(query), { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => /** @type {any} */ (window).__app?.ready === true, null, {
        timeout: READY_TIMEOUT_MS,
        polling: 250,
    });
}

async function frames(page) {
    return page.evaluate(() => /** @type {any} */ (window).__app.stats.frame);
}

/** Frames are slow on SwiftShader (seconds each at full size): wait on counters, not wall time. */
async function waitForErrorCount(page, source, atLeast) {
    await page.waitForFunction(
        ([name, n]) => {
            const app = /** @type {any} */ (window).__app;
            return (app.stats.systemErrors[name] ?? 0) >= n;
        },
        [source, atLeast],
        { timeout: 120000, polling: 200 }
    );
}

async function waitFrames(page, n) {
    const start = await frames(page);
    await page.waitForFunction(
        ([from, count]) => /** @type {any} */ (window).__app.stats.frame >= from + count,
        [start, n],
        { timeout: 60000, polling: 100 }
    );
}

const { browser, page, errors } = await launchPage({ logConsole: false });
// A small viewport: the point is the boundary, not the pixels, and SwiftShader time is per pixel.
await page.setViewportSize({ width: 320, height: 240 });
const lines = [];
page.on('console', (msg) => lines.push({ type: msg.type(), text: msg.text() }));

try {
    // 1. A system that throws every frame: contained, reported once, loop alive.
    await ready(page, '/?webgl&no-post&test');
    const quietBefore = lines.filter((l) => l.type === 'error').length;
    const frameBefore = await frames(page);
    await page.evaluate(() =>
        /** @type {any} */ (window).__app.injectFault('updates', 'faultUpdates')
    );
    await waitForErrorCount(page, 'faultUpdates', 3);
    await waitFrames(page, 3);
    const afterUpdates = await page.evaluate(() => ({
        frame: /** @type {any} */ (window).__app.stats.frame,
        errors: /** @type {any} */ (window).__app.errors
            .list()
            .filter((e) => e.source === 'faultUpdates'),
        quarantined: /** @type {any} */ (window).__app.stats.quarantined,
        banner: document.querySelectorAll('#app-error-banner').length,
        bannerText: document.getElementById('app-error-banner')?.textContent ?? '',
        hasReload: Array.from(document.querySelectorAll('#app-error-banner button')).some(
            (b) => b.textContent === 'Reload'
        ),
        renderCalls: /** @type {any} */ (window).__app.renderer.info.render.frame,
    }));
    check(afterUpdates.frame > frameBefore + 2, 'render loop keeps ticking after a system throws');
    check(afterUpdates.errors.length === 1, 'the fault is recorded as one distinct error');
    check(
        afterUpdates.quarantined.includes('faultUpdates'),
        'a system that keeps throwing is switched off',
        JSON.stringify(afterUpdates.quarantined)
    );
    check(afterUpdates.banner === 1, 'exactly one banner is shown');
    check(afterUpdates.bannerText.includes('faultUpdates'), 'the banner names the system');
    check(afterUpdates.hasReload, 'the banner offers Reload');
    const faultLines = lines.filter((l) => l.text.includes('faultUpdates'));
    check(
        faultLines.length <= 1,
        'the failure is logged at most once',
        `${faultLines.length} lines`
    );
    check(
        lines.filter((l) => l.type === 'error').length - quietBefore <= 1,
        'no console flood: at most one new console.error'
    );
    check(afterUpdates.renderCalls > 0, 'the renderer is still drawing');

    // 2. A render-phase throw is retried (never switched off) but still logged once.
    lines.length = 0;
    await page.evaluate(() =>
        /** @type {any} */ (window).__app.injectFault('render', 'faultRender')
    );
    await waitForErrorCount(page, 'faultRender', 6);
    const afterRender = await page.evaluate(() => ({
        errors: /** @type {any} */ (window).__app.errors
            .list()
            .filter((e) => e.source === 'faultRender'),
        quarantined: /** @type {any} */ (window).__app.stats.quarantined,
    }));
    check(afterRender.errors.length === 1, 'a render-phase fault is one distinct error');
    check(
        afterRender.errors[0]?.count >= 5,
        'it is retried every frame (counted, not printed)',
        String(afterRender.errors[0]?.count)
    );
    check(
        !afterRender.quarantined.includes('faultRender'),
        'the render phase is never switched off'
    );
    check(
        lines.filter((l) => l.text.includes('faultRender')).length <= 1,
        'render-phase failure logged at most once'
    );

    // 3. An uncaught exception in an event handler: one banner line, one log.
    lines.length = 0;
    await page.evaluate(() => {
        for (let i = 0; i < 20; i++)
            setTimeout(() => {
                throw new Error('handler exploded');
            }, 0);
    });
    await page.waitForTimeout(500);
    const uncaught = await page.evaluate(() => ({
        entry: /** @type {any} */ (window).__app.errors
            .list()
            .find((e) => e.message === 'handler exploded'),
        banners: document.querySelectorAll('#app-error-banner').length,
    }));
    check(
        uncaught.entry?.count === 20,
        'twenty identical uncaught errors are counted as one',
        String(uncaught.entry?.count)
    );
    check(uncaught.banners === 1, 'still a single banner');

    // 4. An unhandled rejection is recorded but does not raise the banner.
    const bannerTextBefore = await page.evaluate(
        () => document.getElementById('app-error-banner')?.textContent
    );
    await page.evaluate(() => {
        Promise.reject(new Error('background fetch rejected'));
    });
    await page.waitForTimeout(300);
    const rej = await page.evaluate(() => ({
        entry: /** @type {any} */ (window).__app.errors
            .list()
            .find((e) => e.message === 'background fetch rejected'),
        text: document.getElementById('app-error-banner')?.textContent,
    }));
    check(rej.entry?.kind === 'rejection', 'an unhandled rejection is recorded');
    check(rej.text === bannerTextBefore, 'it does not add to the banner');
} catch (e) {
    check(false, `section 1-4 threw: ${e.message}`);
}

// 5. Stale chunk: a lazy chunk that 404s reloads the page exactly once, then stops.
try {
    // Block the service worker: once it controls the page it answers from its precache and
    // page.route() never sees the request, so the simulated 404 would not happen.
    const ctx2 = await browser.newContext({
        viewport: { width: 320, height: 240 },
        serviceWorkers: 'block',
    });
    const page2 = await ctx2.newPage();
    let documentLoads = 0;
    page2.on('request', (req) => {
        if (req.resourceType() === 'document' && req.url().startsWith(url('/'))) documentLoads += 1;
    });
    await page2.route('**/assets/MultiplayerRoom-*.js', (route) => route.abort());
    // A signaling URL makes the entry import the room chunk; the host does not matter.
    await page2.goto(url('/?webgl&no-post&test&signal=http://127.0.0.1:9'), {
        waitUntil: 'load',
        timeout: 60000,
    });
    // Poll from Node: both waitForSelector and waitForFunction can reject with "context
    // destroyed" when the reload lands mid-poll, so a read that fails is simply retried.
    let stale = null;
    for (let attempt = 0; attempt < 480 && !stale; attempt++) {
        try {
            const read = await page2.evaluate(() => ({
                banner: document.getElementById('app-error-banner')?.textContent ?? '',
                reloadAt: sessionStorage.getItem('dice:chunk-reload-at'),
            }));
            if (read.banner) stale = read;
        } catch {
            /* mid-navigation */
        }
        if (!stale) await page2.waitForTimeout(500);
    }
    stale ??= { banner: '', reloadAt: null };
    check(
        documentLoads === 2,
        'a 404ing chunk reloads exactly once',
        `${documentLoads} document loads`
    );
    check(stale.banner.includes('out of date'), 'the second failure stops reloading and says so');
    check(stale.banner.includes('Clear cache'), 'the banner offers a cache-clearing reload');
    check(Boolean(stale.reloadAt), 'the attempt is remembered for this tab');
    await ctx2.close();
} catch (e) {
    check(false, `stale-chunk section threw: ${e.message}`);
}

// 6. Boot failure: no usable GL at all must read as a message, not "Loading Tavern..." forever.
try {
    const page3 = await browser.newPage({ viewport: { width: 320, height: 240 } });
    await page3.addInitScript(() => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
            if (/webgl/i.test(String(type))) return null;
            return orig.call(this, type, ...rest);
        };
        // keep WebGPU out of the way as well
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    });
    await page3.goto(url('/?webgl&no-post&test'), { waitUntil: 'load', timeout: 60000 });
    await page3.waitForFunction(
        () =>
            document.getElementById('loading-text')?.textContent ===
                'The tavern could not start.' || /** @type {any} */ (window).__app?.ready === true,
        null,
        { timeout: 120000, polling: 250 }
    );
    const boot = await page3.evaluate(() => ({
        text: document.getElementById('loading-text')?.textContent,
        ready: /** @type {any} */ (window).__app?.ready === true,
        banner: document.getElementById('app-error-banner')?.textContent ?? '',
    }));
    check(!boot.ready, 'with no WebGL the app does not claim to be ready');
    check(
        boot.text === 'The tavern could not start.',
        'the loading overlay says the boot failed',
        boot.text
    );
    check(boot.banner.includes('Reload'), 'a reload action is offered');
    await page3.close();
} catch (e) {
    check(false, `boot-failure section threw: ${e.message}`);
}

await browser.close();
const unexpected = errors.filter(
    (e) =>
        !/404|injected fault|faultUpdates|faultRender|handler exploded|background fetch|dynamically imported|Failed to load resource|ERR_FAILED/i.test(
            e
        )
);
check(
    unexpected.length === 0,
    'no unexpected console/page errors',
    unexpected.slice(0, 3).join(' | ')
);
console.log(
    failed === 0
        ? '\nerror boundary: all checks passed'
        : `\nerror boundary: ${failed} check(s) failed`
);
process.exit(failed === 0 ? 0 : 1);
