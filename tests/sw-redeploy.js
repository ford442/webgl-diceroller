/**
 * Service-worker update across a redeploy (#383), end to end on one origin.
 *
 *   npm run test:sw-redeploy
 *
 * Builds two trivially different bundles (different BUILD_COMMIT, so different
 * hashed chunks and precache revisions), serves them from one host that can be
 * swapped underneath the browser and that sends the documented Cache-Control
 * (scripts/lib/cachePolicy.mjs), then:
 *
 *   1. opens build A and lets its service worker install and take control,
 *   2. swaps the host to build B (old hashed files stay, as `deploy.py` leaves them),
 *   3. asks the worker to update and expects the "new version is ready" notice,
 *   4. reloads and expects build B's commit, build B's precache (A's entries gone),
 *   5. requires zero console errors and zero unexpected 4xx the whole way.
 *
 * Needs no WASM. SW_DIST_A / SW_DIST_B point at prebuilt dist dirs to skip building.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { classify } from '../scripts/lib/cachePolicy.mjs';
import { capturePng } from './helpers/browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const READY_TIMEOUT_MS = 240000;

let failed = 0;
const check = (cond, label, extra = '') => {
    console.log(`${cond ? 'ok' : 'FAIL'}: ${label}${!cond && extra ? `  (${extra})` : ''}`);
    if (!cond) failed += 1;
};

function build(outDir, commit) {
    console.log(`building ${commit.slice(0, 7)} -> ${outDir}`);
    const run = (cmd, args) =>
        spawnSync(cmd, args, {
            cwd: ROOT,
            env: { ...process.env, BUILD_COMMIT: commit, BROWSER: 'none' },
            stdio: ['ignore', 'ignore', 'inherit'],
        });
    run('node', ['scripts/generate-pwa-icons.mjs']);
    const res = run(path.join(ROOT, 'node_modules/.bin/vite'), [
        'build',
        '--outDir',
        outDir,
        '--emptyOutDir',
    ]);
    if (res.status !== 0) throw new Error(`vite build failed for ${commit.slice(0, 7)}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-redeploy-'));
const distA = process.env.SW_DIST_A || path.join(tmp, 'a');
const distB = process.env.SW_DIST_B || path.join(tmp, 'b');
if (!process.env.SW_DIST_A) build(distA, COMMIT_A);
if (!process.env.SW_DIST_B) build(distB, COMMIT_B);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.ktx2': 'image/ktx2',
};

/** The layers the host serves from, newest first: after a deploy, B then the files A left behind. */
let layers = [distA];
const served = []; // [{ path, status, cacheControl }]

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    const base = {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
    };
    for (const dir of layers) {
        const file = path.join(dir, rel);
        if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
        const cls = classify(rel);
        const cacheControl =
            cls?.id === 'hashed'
                ? 'public, max-age=31536000, immutable'
                : cls?.id === 'static'
                  ? 'public, max-age=86400, stale-while-revalidate=604800'
                  : 'no-cache';
        res.writeHead(200, {
            ...base,
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': cacheControl,
        });
        served.push({ path: rel, status: 200, cacheControl });
        fs.createReadStream(file).pipe(res);
        return;
    }
    served.push({ path: rel, status: 404 });
    res.writeHead(404, base);
    res.end('not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const origin = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;

const browser = await chromium.launch({
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
    ],
    executablePath: process.env.PW_CHROMIUM_PATH,
});
const ctx = await browser.newContext({
    viewport: { width: 320, height: 240 },
    serviceWorkers: 'allow',
});
const page = await ctx.newPage();
const problems = [];
const bad = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|GL Driver/.test(m.text()))
        problems.push(`console: ${m.text()}`);
});
// The only expected 404s are the physics artifacts of a build without WASM.
page.on('response', (r) => {
    if (r.status() >= 400 && !/\/wasm(-scalar)?\//.test(r.url()))
        bad.push(`${r.status()} ${r.url()}`);
});

const ready = () =>
    page.waitForFunction(() => /** @type {any} */ (window).__app?.ready === true, null, {
        timeout: READY_TIMEOUT_MS,
        polling: 250,
    });
const commitOf = () => page.evaluate(() => /** @type {any} */ (window).__app.buildInfo?.commit);

try {
    // 1. Build A, with its service worker in control.
    await page.goto(`${origin}/?webgl&no-post&test`, { waitUntil: 'load', timeout: 120000 });
    await ready();
    check(
        (await commitOf()) === COMMIT_A,
        'build A is what the first visit runs',
        String(await commitOf())
    );
    const swState = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        const deadline = Date.now() + 30000;
        while (!navigator.serviceWorker.controller && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 200));
        return {
            active: Boolean(reg.active),
            controlled: Boolean(navigator.serviceWorker.controller),
        };
    });
    check(swState.active, 'the service worker for build A is active');
    if (!swState.controlled) {
        // First visit: clientsClaim should have claimed us; if the browser did not, one reload does.
        await page.reload({ waitUntil: 'load' });
        await ready();
    }
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    check(controlled, "the page is controlled by build A's worker before the redeploy");

    const precacheA = await page.evaluate(async () => {
        const names = await caches.keys();
        const pre = names.find((n) => /precache/.test(n));
        if (!pre) return [];
        return (await (await caches.open(pre)).keys()).map((r) => new URL(r.url).pathname);
    });
    const indexA = precacheA.find((p) => /\/assets\/index-[^/]+\.js$/.test(p));
    check(Boolean(indexA), "build A's entry chunk is precached", String(indexA));

    // 2. The redeploy: B on top, A's files left behind (deploy.py never deletes).
    layers = [distB, distA];
    const info = await page.evaluate(async () =>
        (await fetch(`./build-info.json?cb=${Date.now()}`, { cache: 'no-store' })).json()
    );
    check(
        info.commit === COMMIT_B,
        'live build-info.json reports build B after the swap',
        info.commit
    );

    // 3. The worker finds build B and takes over; the open tab announces it.
    await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        await reg.update();
    });
    await page.waitForSelector('#app-error-banner', { timeout: 120000 });
    const notice = await page.evaluate(() => {
        const el = document.getElementById('app-error-banner');
        return { text: el?.textContent ?? '', role: el?.getAttribute('role') };
    });
    if (process.env.SW_SHOT_DIR) {
        fs.mkdirSync(process.env.SW_SHOT_DIR, { recursive: true });
        await capturePng(page, path.join(process.env.SW_SHOT_DIR, 'sw-update-notice.png'));
    }
    check(
        /new version is ready/i.test(notice.text),
        'the open tab says a new version is ready',
        notice.text
    );
    check(notice.role === 'status', 'the notice is a status, not an alert', String(notice.role));
    check(
        (await commitOf()) === COMMIT_A,
        'the open tab is not yanked to the new build underneath the player'
    );

    // 4. Reload: build B, from build B's precache.
    await page.evaluate(() => {
        const buttons = /** @type {HTMLElement[]} */ (
            Array.from(document.querySelectorAll('#app-error-banner button'))
        );
        buttons.find((b) => b.textContent === 'Reload')?.click();
    });
    await page.waitForLoadState('load');
    await ready();
    check(
        (await commitOf()) === COMMIT_B,
        'after Reload the page runs build B',
        String(await commitOf())
    );
    const precacheB = await page.evaluate(async () => {
        const names = await caches.keys();
        const pre = names.find((n) => /precache/.test(n));
        if (!pre) return [];
        return (await (await caches.open(pre)).keys()).map((r) => new URL(r.url).pathname);
    });
    check(
        precacheB.some((p) => /\/assets\/index-[^/]+\.js$/.test(p) && p !== indexA),
        "the precache holds build B's entry chunk"
    );
    check(
        !precacheB.includes(indexA),
        "build A's entry chunk was dropped from the precache (cleanupOutdatedCaches)"
    );

    // 5. Nothing noisy on the way.
    check(
        problems.length === 0,
        'no console / page errors across the update',
        problems.slice(0, 3).join(' | ')
    );
    check(
        bad.length === 0,
        'no 4xx responses across the update (apart from the absent WASM)',
        bad.slice(0, 3).join(' | ')
    );

    // Evidence in the shape of `curl -sI`.
    console.log('\nheaders the host sent during the run:');
    const seen = new Map();
    for (const s of served)
        if (s.status === 200 && !seen.has(classify(s.path)?.id)) seen.set(classify(s.path)?.id, s);
    for (const [id, s] of seen)
        console.log(
            `  ${String(id).padEnd(11)} ${s.path.padEnd(48)} cache-control: ${s.cacheControl}`
        );
} catch (error) {
    check(false, `redeploy run aborted: ${error.message}`);
}

await browser.close();
server.close();
if (!process.env.SW_DIST_A && !process.env.SW_DIST_B)
    fs.rmSync(tmp, { recursive: true, force: true });
console.log(
    failed === 0 ? '\nsw-redeploy: all checks passed' : `\nsw-redeploy: ${failed} check(s) failed`
);
process.exit(failed === 0 ? 0 : 1);
