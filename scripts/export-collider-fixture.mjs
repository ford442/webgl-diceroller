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
 * The file is `{ hash, world }`: the world plus `hashWorld(world)`, the same
 * hash share links carry as `w=` and room joins compare (#369). It is checked
 * in. Re-run after adding, moving or re-shaping a prop's colliders; CI
 * regenerates it and fails on a diff — hash first, so the message says whether
 * the *world* moved or only ids / registration order did.
 *
 * Every prop draws its layout from the seeded stream the kit hands it, so two
 * runs at one `layout-seed` write byte-identical files.
 *
 * Usage:
 *   npm run build:wasm && npm run build:js
 *   npm run fixture:world                 # writes the fixture
 *   npm run fixture:world -- --check      # exits 1 if the checked-in file differs
 *
 * Env: DICE_BASE_URL to use an already-running preview instead of starting one.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashWorld, serializeWorldFixtureFile } from 'dice-core/wasm/WorldRecorder';

import { launchPage } from '../tests/helpers/browser.js';
import { startPreview } from '../tests/helpers/server.js';

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
        const { world, pageHash } = await page.evaluate(() => ({
            world: window.__app.physics.exportWorld?.(),
            pageHash: window.__app.physics.worldHash?.(),
        }));
        if (!world?.init) throw new Error('world recorder returned nothing (is ?test honoured?)');
        // The page hashes in the browser, this script in Node: they must agree,
        // or `w=` links and room joins would compare apples to oranges.
        const hash = hashWorld(world);
        if (pageHash !== hash) {
            throw new Error(`page worldHash ${pageHash} != hashWorld(exportWorld()) ${hash}`);
        }
        return { world, hash, errors };
    } finally {
        await browser.close();
    }
}

async function main() {
    let server = null;
    let base = process.env.DICE_BASE_URL;
    if (!base) {
        server = await startPreview({ port: 4191 });
        base = server.base;
    }
    try {
        const { world, hash } = await capture(base);
        const text = serializeWorldFixtureFile({ hash, world });
        const summary =
            `${world.statics.length} statics, ${world.dynamics.length} dynamics ` +
            `(table plane y=${world.init.tableY}), world ${hash}`;
        if (check) {
            const current = await readFile(FIXTURE, 'utf8').catch(() => '');
            if (current !== text) {
                const recorded = /"hash":\s*"([0-9a-f]+)"/.exec(current)?.[1] ?? 'none';
                // The hash first: it ignores ids and registration order, so it
                // separates "a collider moved" from "same world, different ids".
                const why =
                    recorded === hash
                        ? `the world is unchanged (${hash}) but collider ids or registration order moved`
                        : `the world changed: fixture ${recorded}, app ${hash}`;
                console.error(
                    `[fixture:world] ${path.relative(REPO_ROOT, FIXTURE)} is stale — ${why}; ` +
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
