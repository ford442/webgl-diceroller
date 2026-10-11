#!/usr/bin/env node
/**
 * Export the tavern's collider world to tests/fixtures/tavern-world.json.
 *
 * Boots the built app (vite preview) with a pinned table layout, waits for
 * every tier to load, and dumps what the page registered in the physics engine
 * — table bounds, walls, props, dynamic clutter — via the `?test` world
 * recorder (`window.__app.physics.exportWorld()`, src/core-engine/wasm/
 * WorldRecorder.ts). The native and WASM tavern-world settle tests replay that
 * file, so the solver is tested against the world the app actually builds
 * rather than a lone plane (#341).
 *
 * The file is checked in. Re-run after adding, moving or re-shaping a prop's
 * colliders; CI regenerates it and fails on a diff.
 *
 * Usage:
 *   npm run build:wasm && npm run build:js
 *   npm run fixture:world                 # writes the fixture
 *   npm run fixture:world -- --check      # exits 1 if the checked-in file differs
 *
 * Env: DICE_BASE_URL to use an already-running preview instead of starting one.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { launchPage } = require('../tests/helpers/browser.js');
const { startPreview } = require('../tests/helpers/server.js');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/tavern-world.json');
// In-process engine (no worker): every add* returns the engine's real answer,
// so a rejected collider never reaches the fixture. The layout is pinned the
// way a share link pins it.
const QUERY = '?webgl&no-post&test&no-worker&layout-seed=1&density=med&theme=default';
const LOAD_TIMEOUT_MS = 240000;

const check = process.argv.includes('--check');

async function capture(base) {
    const { browser, page, errors } = await launchPage({ logConsole: false });
    try {
        await page.goto(`${base}/${QUERY}`, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        await page.waitForFunction(() => window.__app?.ready === true, null, {
            timeout: LOAD_TIMEOUT_MS,
        });
        const wasm = await page.evaluate(() => window.__app.isWasmAvailable?.() === true);
        if (!wasm) throw new Error('WASM physics not available — run `npm run build:wasm` first');
        const world = await page.evaluate(() => window.__app.physics.exportWorld?.());
        if (!world?.init) throw new Error('world recorder returned nothing (is ?test honoured?)');
        return { world, errors };
    } finally {
        await browser.close();
    }
}

/** One collider per line: a moved prop shows up as a one-line diff. */
function serializeWorld(world) {
    const list = (items) =>
        items.length
            ? `[\n${items.map((item) => `  ${JSON.stringify(item)}`).join(',\n')}\n ]`
            : '[]';
    return (
        `{\n "version": ${world.version},\n "init": ${JSON.stringify(world.init)},\n` +
        ` "statics": ${list(world.statics)},\n "dynamics": ${list(world.dynamics)}\n}\n`
    );
}

async function main() {
    let server = null;
    let base = process.env.DICE_BASE_URL;
    if (!base) {
        server = await startPreview({ port: 4191 });
        base = server.base;
    }
    try {
        const { world } = await capture(base);
        const text = serializeWorld(world);
        const summary =
            `${world.statics.length} statics, ${world.dynamics.length} dynamics ` +
            `(table plane y=${world.init.tableY})`;
        if (check) {
            const current = await readFile(FIXTURE, 'utf8').catch(() => '');
            if (current !== text) {
                console.error(
                    `[fixture:world] ${path.relative(REPO_ROOT, FIXTURE)} is stale — ` +
                        `the app now registers ${summary}. Run \`npm run fixture:world\` and commit it.`
                );
                process.exit(1);
            }
            console.log(`[fixture:world] up to date: ${summary}`);
            return;
        }
        await writeFile(FIXTURE, text);
        console.log(`[fixture:world] wrote ${path.relative(REPO_ROOT, FIXTURE)}: ${summary}`);
    } finally {
        await server?.close();
    }
}

main().catch((err) => {
    console.error('[fixture:world] FAILED:', err.message);
    process.exit(1);
});
