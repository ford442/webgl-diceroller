#!/usr/bin/env node
/**
 * Fail CI when the total dist/ payload (everything deploy.py uploads) exceeds
 * a budget. Guards against a stray multi-MB asset (an unreferenced fallback,
 * a forgotten raw source file) silently landing in `public/` and shipping on
 * every release.
 *
 * Run after: npm run build:js
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '../dist');
const DEPLOY_SIZE_MAX_BYTES = JSON.parse(
    await readFile(resolve(__dirname, 'bundle-budgets.json'), 'utf8')
).totals.deploySizeMaxBytes;

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    let total = 0;
    const rows = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = await walk(fullPath);
            total += sub.total;
            rows.push(...sub.rows);
        } else {
            const { size } = await stat(fullPath);
            total += size;
            rows.push({ path: fullPath, size });
        }
    }
    return { total, rows };
}

const { total, rows } = await walk(distDir);

rows.sort((a, b) => b.size - a.size);
console.log('Largest dist/ files:\n');
for (const { path, size } of rows.slice(0, 15)) {
    console.log(`  ${(size / 1024).toFixed(1).padStart(9)} KB  ${path.replace(distDir, 'dist')}`);
}

// Where the bytes are, by top-level directory (files at the root are grouped as "(root)").
const groups = new Map();
for (const { path, size } of rows) {
    const rel = path.slice(distDir.length + 1);
    const top = rel.includes('/') ? rel.split('/')[0] : '(root)';
    groups.set(top, (groups.get(top) ?? 0) + size);
}
console.log('\nBy directory:\n');
for (const [name, size] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(size / 1024).toFixed(1).padStart(9)} KB  ${name}`);
}
// A bundle built without the physics artifacts is not a releasable size: say so rather than pass quietly.
const hasWasm = rows.some(({ path }) => /\/wasm\/dice_physics\.wasm$/.test(path));
const hasScalar = rows.some(({ path }) => /\/wasm-scalar\/dice_physics\.wasm$/.test(path));
if (!hasWasm || !hasScalar) {
    console.log(
        `\nnote: dist/ has no ${[!hasWasm && 'wasm/dice_physics.wasm', !hasScalar && 'wasm-scalar/dice_physics.wasm'].filter(Boolean).join(' or ')}: ` +
            'this is a build:js:allow-missing-wasm bundle. The budget below includes an allowance for both engines; ' +
            're-check the real figure after `npm run build`.'
    );
}

console.log(`\nTotal dist/ size: ${(total / 1024 / 1024).toFixed(2)} MB`);

if (total > DEPLOY_SIZE_MAX_BYTES) {
    console.error(
        `\nFAIL: dist/ size ${total} B exceeds budget ${DEPLOY_SIZE_MAX_BYTES} B (${(DEPLOY_SIZE_MAX_BYTES / 1024 / 1024).toFixed(1)} MB)`
    );
    process.exit(1);
}

console.log(`\nok: dist/ size ${total} B <= ${DEPLOY_SIZE_MAX_BYTES} B`);
