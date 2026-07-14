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
const budgets = JSON.parse(
    await readFile(resolve(__dirname, 'bundle-budgets.json'), 'utf8')
);

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

const files = (await readdir(distAssets))
    .filter((name) => name.endsWith('.js'))
    .sort();

let failed = 0;
let totalGzip = 0;
const rows = [];

for (const file of files) {
    const raw = await readFile(resolve(distAssets, file));
    const gz = await gzipSize(raw);
    totalGzip += gz;
    rows.push({ file, raw: raw.length, gzip: gz });
}

console.log('Production JS bundle sizes:\n');
for (const { file, raw, gzip } of rows) {
    console.log(`  ${file.padEnd(42)} ${(raw / 1024).toFixed(1).padStart(7)} KB raw  ${(gzip / 1024).toFixed(1).padStart(6)} KB gzip`);
}

console.log(`\n  ${'TOTAL'.padEnd(42)} ${' '.repeat(7)}        ${(totalGzip / 1024).toFixed(1).padStart(6)} KB gzip`);

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

if (totalGzip > budgets.totals.jsGzipMax) {
    failed += 1;
    console.error(
        `\nFAIL: total JS gzip ${totalGzip} B exceeds budget ${budgets.totals.jsGzipMax} B`
    );
} else {
    console.log(`\nok: total JS gzip ${totalGzip} B <= ${budgets.totals.jsGzipMax} B`);
}

if (failed > 0) {
    console.error(`\n${failed} bundle budget(s) exceeded`);
    process.exit(1);
}

console.log('\nAll bundle budgets passed.');
