#!/usr/bin/env node
/**
 * Fail CI when production JS chunks exceed gzip budgets.
 * Run after: npm run build:js
 */
import { readdir, readFile } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distAssets = resolve(__dirname, '../dist/assets');
const budgets = JSON.parse(await readFile(resolve(__dirname, 'bundle-budgets.json'), 'utf8'));

function gzipSize(buffer) {
    return new Promise((resolveSize, reject) => {
        const gzip = createGzip();
        const chunks = [];
        gzip.on('data', (c) => chunks.push(c));
        gzip.on('error', reject);
        gzip.on('end', () => resolveSize(Buffer.concat(chunks).length));
        gzip.end(buffer);
    });
}

const files = (await readdir(distAssets)).filter((name) => name.endsWith('.js')).sort();

const demandLoaded = budgets.demandLoaded ?? [];

/**
 * Chunks only some sessions ever fetch (WebGPU-only, ?xr-only, ?no-wasm-only).
 * They are held to their own per-chunk budgets and to `allChunksGzipMax`, but
 * they are kept out of the every-session total so that adding a conditional
 * feature cannot silently eat the eager download budget — and so that the eager
 * number keeps meaning "what a user actually downloads".
 */
function demandLoadedReason(file) {
    const match = demandLoaded.find((entry) => new RegExp(entry.pattern).test(`assets/${file}`));
    return match?.reason ?? null;
}

let failed = 0;
let totalGzip = 0;
let eagerGzip = 0;
const rows = [];

for (const file of files) {
    const raw = await readFile(resolve(distAssets, file));
    const gz = await gzipSize(raw);
    const reason = demandLoadedReason(file);
    totalGzip += gz;
    if (!reason) eagerGzip += gz;
    rows.push({ file, raw: raw.length, gzip: gz, reason });
}

console.log('Production JS bundle sizes:\n');
for (const { file, raw, gzip, reason } of rows) {
    console.log(
        `  ${file.padEnd(42)} ${(raw / 1024).toFixed(1).padStart(7)} KB raw  ${(gzip / 1024).toFixed(1).padStart(6)} KB gzip` +
            (reason ? `  [demand-loaded: ${reason}]` : '')
    );
}

console.log(
    `\n  ${'EAGER TOTAL'.padEnd(42)} ${' '.repeat(7)}        ${(eagerGzip / 1024).toFixed(1).padStart(6)} KB gzip` +
        `\n  ${'ALL CHUNKS'.padEnd(42)} ${' '.repeat(7)}        ${(totalGzip / 1024).toFixed(1).padStart(6)} KB gzip`
);

for (const [name, budget] of Object.entries(budgets.chunks)) {
    const match = rows.find(({ file }) => new RegExp(budget.pattern).test(`assets/${file}`));
    if (!match) {
        console.warn(`\nWARN: no file matched budget "${name}" (${budget.pattern})`);
        continue;
    }
    if (match.gzip > budget.gzipMax) {
        failed += 1;
        console.error(
            `\nFAIL: ${name} gzip ${match.gzip} B exceeds budget ${budget.gzipMax} B (${match.file})`
        );
    } else {
        console.log(`\nok: ${name} gzip ${match.gzip} B <= ${budget.gzipMax} B`);
    }
}

if (eagerGzip > budgets.totals.jsGzipMax) {
    failed += 1;
    console.error(
        `\nFAIL: eager JS gzip ${eagerGzip} B exceeds budget ${budgets.totals.jsGzipMax} B`
    );
} else {
    console.log(`\nok: eager JS gzip ${eagerGzip} B <= ${budgets.totals.jsGzipMax} B`);
}

const allChunksMax = budgets.totals.allChunksGzipMax;
if (allChunksMax != null) {
    if (totalGzip > allChunksMax) {
        failed += 1;
        console.error(`\nFAIL: all-chunks JS gzip ${totalGzip} B exceeds budget ${allChunksMax} B`);
    } else {
        console.log(`\nok: all-chunks JS gzip ${totalGzip} B <= ${allChunksMax} B`);
    }
}

if (failed > 0) {
    console.error(`\n${failed} bundle budget(s) exceeded`);
    process.exit(1);
}

console.log('\nAll bundle budgets passed.');
