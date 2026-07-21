#!/usr/bin/env node
/**
 * Post-deploy / production cross-origin isolation check.
 *
 * SharedArrayBuffer (worker-physics fast path) requires HTTP headers:
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 *
 * A <meta http-equiv> tag is NOT sufficient — browsers only honor COOP/COEP
 * from actual response headers. Vite dev/preview set these in vite.config.js;
 * static hosts (nginx / Caddy / Cloudflare) must be configured separately.
 *
 * Usage:
 *   node scripts/verify-production-isolation.mjs
 *   node scripts/verify-production-isolation.mjs https://test.1ink.us/dice-roller/
 *   PROD_URL=https://go.1ink.us/dice-roller/ npm run verify:production-isolation
 *
 * Exit codes:
 *   0 — headers + crossOriginIsolated (+ SAB when WASM worker engages)
 *   1 — hard failure (missing headers / not isolated)
 *   2 — soft failure (isolated but worker did not report SAB; WASM may be absent)
 */
import { chromium } from 'playwright';

const DEFAULT_URL = process.env.PROD_URL
    || process.env.PRODUCTION_URL
    || 'https://test.1ink.us/dice-roller/';

const targetArg = process.argv.find((a) => /^https?:\/\//i.test(a));
const TARGET = (targetArg || DEFAULT_URL).replace(/\/?$/, '/');

const REQUIRED_HEADERS = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
};

function headerValue(headers, name) {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === lower) return String(v).trim().toLowerCase();
    }
    return null;
}

async function checkHttpHeaders(url) {
    const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'text/html' },
    });
    const headers = Object.fromEntries(res.headers.entries());
    const report = {
        url: res.url,
        status: res.status,
        coop: headerValue(headers, 'cross-origin-opener-policy'),
        coep: headerValue(headers, 'cross-origin-embedder-policy'),
        corp: headerValue(headers, 'cross-origin-resource-policy'),
    };

    const failures = [];
    if (!res.ok) failures.push(`HTTP ${res.status} fetching ${url}`);
    for (const [name, expected] of Object.entries(REQUIRED_HEADERS)) {
        const actual = headerValue(headers, name);
        if (actual !== expected) {
            failures.push(
                `${name}: expected "${expected}", got ${actual === null ? '(missing)' : JSON.stringify(actual)}`
            );
        }
    }

    // CORP is recommended for static assets under COEP; on the HTML document
    // itself it is optional when everything is same-origin. Report only.
    if (!report.corp) {
        console.log(
            'INFO: Cross-Origin-Resource-Policy not set on document '
            + '(ok for same-origin apps; set "same-origin" on CDN assets if needed)'
        );
    } else {
        console.log(`ok: Cross-Origin-Resource-Policy: ${report.corp}`);
    }

    return { report, failures };
}

async function checkBrowserIsolation(url) {
    const browser = await chromium.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ],
    });
    try {
        const page = await browser.newPage();
        await page.goto(`${url}?webgl&no-post&fair-dice&worker-physics`, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
        });

        // Isolation is available immediately from response headers; do not wait
        // on the full scene (production may be slow / WASM optional).
        const early = await page.evaluate(() => ({
            crossOriginIsolated: window.crossOriginIsolated === true,
            sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
            metaCoop: document.querySelector('meta[http-equiv="Cross-Origin-Opener-Policy"]')?.content ?? null,
            metaCoep: document.querySelector('meta[http-equiv="Cross-Origin-Embedder-Policy"]')?.content ?? null,
        }));

        // Best-effort: if the app exposes physics after load, confirm SAB transport.
        let worker = null;
        try {
            await page.waitForFunction(
                () => window.sceneReady === true || window.physicsWorld != null,
                null,
                { timeout: 45000 }
            ).catch(() => {});
            worker = await page.evaluate(async () => {
                // Dynamic import of the bundled physics bridge is not stable by
                // chunk name; prefer any debug hooks, else infer from isolation.
                const sabOk = window.crossOriginIsolated === true
                    && typeof SharedArrayBuffer === 'function';
                return {
                    sceneReady: window.sceneReady ?? false,
                    inferredSABAvailable: sabOk,
                };
            });
        } catch {
            worker = { sceneReady: false, inferredSABAvailable: early.sharedArrayBuffer && early.crossOriginIsolated };
        }

        return { early, worker };
    } finally {
        await browser.close();
    }
}

console.log(`Checking production isolation: ${TARGET}\n`);

let failed = 0;
let softFailed = 0;

const { report, failures } = await checkHttpHeaders(TARGET);
console.log(JSON.stringify(report, null, 2));
for (const f of failures) {
    console.error(`FAIL: ${f}`);
    failed += 1;
}
if (failures.length === 0) {
    console.log('ok: COOP/COEP response headers present');
}

const browserResult = await checkBrowserIsolation(TARGET);
console.log(JSON.stringify(browserResult, null, 2));

if (!browserResult.early.crossOriginIsolated) {
    console.error('FAIL: window.crossOriginIsolated === false');
    if (browserResult.early.metaCoop || browserResult.early.metaCoep) {
        console.error(
            'NOTE: COOP/COEP meta tags were found — they do NOT enable isolation. '
            + 'Configure HTTP response headers on the host / CDN.'
        );
    }
    failed += 1;
} else {
    console.log('ok: window.crossOriginIsolated === true');
}

if (!browserResult.early.sharedArrayBuffer) {
    console.error('FAIL: SharedArrayBuffer is not available in this browsing context');
    failed += 1;
} else {
    console.log('ok: SharedArrayBuffer constructor is available (worker SAB path can engage)');
}

if (browserResult.worker && !browserResult.worker.inferredSABAvailable) {
    softFailed += 1;
    console.error('SOFT: could not confirm SAB availability after scene probe');
}

if (failed > 0) {
    console.error(`\n${failed} production isolation check(s) failed.`);
    console.error('See docs/WASM_ENGINE.md § Cross-origin isolation and README deploy section.');
    process.exit(1);
}

if (softFailed > 0) {
    console.error(`\n${softFailed} soft check(s) — headers OK but worker SAB not confirmed.`);
    process.exit(2);
}

console.log('\nProduction isolation checks passed (COOP/COEP + crossOriginIsolated + SAB).');
process.exit(0);
