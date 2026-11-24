#!/usr/bin/env node
/**
 * Does the host send the documented Cache-Control per path class? (#383)
 *
 *   node scripts/verify-cache-headers.mjs https://test.1ink.us/dice-roller/
 *   DICE_BASE_URL=http://127.0.0.1:4173 node scripts/verify-cache-headers.mjs
 *   npm run verify:cache-headers -- <url> [--report-only]
 *
 * It reads the page's own index.html to find a real hashed bundle, then HEADs
 * one representative file of each class and prints the evidence (the same
 * lines `curl -sI` shows). Exit 1 on a violation unless --report-only.
 * `vite preview` sends no Cache-Control on hashed files, so against a local
 * preview the "hashed" row is expected to fail: that is the host's job.
 */
import { CACHE_CLASSES, classify, parseCacheControl, wasmTypeError } from './lib/cachePolicy.mjs';

const args = process.argv.slice(2);
const reportOnly = args.includes('--report-only') || process.env.CACHE_REPORT_ONLY === '1';
const target = args.find((a) => /^https?:\/\//i.test(a)) || process.env.DICE_BASE_URL || '';
if (!target) {
    console.error('usage: verify-cache-headers.mjs <base-url> [--report-only]');
    process.exit(2);
}
const base = target.replace(/\/?$/, '/');

async function head(path) {
    const url = new URL(path, base).toString();
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.status === 405 || res.status === 501) res = await fetch(url, { redirect: 'follow' });
    return { url, res };
}

let failed = 0;
const rows = [];

async function checkPath(path, classId) {
    const cls = CACHE_CLASSES.find((c) => c.id === classId);
    const { url, res } = await head(path);
    const cacheControl = res.headers.get('cache-control');
    const contentType = res.headers.get('content-type');
    const problems = [];
    if (!res.ok) problems.push(`HTTP ${res.status}`);
    else {
        const err = cls.check(parseCacheControl(cacheControl));
        if (err) problems.push(err);
        if (classId === 'wasm' && path.endsWith('.wasm')) {
            const typeErr = wasmTypeError(contentType);
            if (typeErr) problems.push(typeErr);
        }
    }
    rows.push({ path, classId, status: res.status, cacheControl, contentType, problems });
    console.log(`\n${problems.length ? 'FAIL' : 'ok  '} ${cls.label}`);
    console.log(`  GET ${url}  ->  ${res.status}`);
    console.log(`  cache-control: ${cacheControl ?? '(none)'}`);
    console.log(`  content-type:  ${contentType ?? '(none)'}`);
    console.log(`  required:      ${cls.expect}`);
    for (const p of problems) console.log(`  problem:       ${p}`);
    if (problems.length) failed += 1;
}

// The page tells us which hashed file is current.
const { res: htmlRes } = await head('index.html');
const html = await (await fetch(new URL('index.html', base))).text();
const hashed = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+\.(?:js|css))"/g)].map((m) =>
    m[1].replace(/^\.?\//, '')
);
if (!htmlRes.ok || hashed.length === 0) {
    console.error(`could not find hashed assets in ${new URL('index.html', base)}`);
    process.exit(1);
}

await checkPath('index.html', 'shell');
await checkPath('sw.js', 'shell');
await checkPath('registerSW.js', 'shell');
await checkPath('manifest.webmanifest', 'shell');
await checkPath('build-info.json', 'build-info');
await checkPath(hashed.find((p) => p.endsWith('.js')) ?? hashed[0], 'hashed');
await checkPath('draco/draco_decoder.wasm', 'static');
await checkPath('images/dice/die_20.glb', 'static');
// The physics artifacts exist only in a full build (`npm run build`).
// The physics artifacts exist only in a full build (`npm run build`). A host with an
// SPA fallback answers a missing file with 200 + index.html, so look at the type too.
const wasmProbe = await fetch(new URL('wasm/dice_physics.wasm', base), { method: 'HEAD' });
if (wasmProbe.ok && !/text\/html/i.test(wasmProbe.headers.get('content-type') ?? '')) {
    await checkPath('wasm/dice_physics.wasm', 'wasm');
} else {
    console.log('\nskip: wasm/dice_physics.wasm is not deployed here (bundle built without WASM)');
}

console.log(`\n${rows.length} paths checked, ${failed} class violation(s).`);
// Every checked path must also classify under the policy table.
const unclassified = rows.filter((r) => !classify(r.path));
if (unclassified.length)
    console.log(`note: ${unclassified.map((r) => r.path).join(', ')} match no class`);
process.exit(failed && !reportOnly ? 1 : 0);
