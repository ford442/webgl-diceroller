/**
 * Playwright smoke test: `?scene=<id>` picks the place the table is set in.
 *
 *  1. `?scene=chart-room` reaches ready, builds *that* document's props (a
 *     table, cup, tower, tray and jail; no TavernWalls), gives the engine
 *     *that* document's physics numbers, and replays a seeded throw to the
 *     same faces on two cold loads (a scene share link is just the current
 *     URL plus `seed=`, so it carries `scene=` with it).
 *  2. An unknown id logs and loads the tavern, whose physics init is the
 *     numbers that used to be literals in PhysicsBootstrap.
 *
 * Prereq: npm run build:js && npm run preview, with WASM built (no dice
 * otherwise, so the roll half cannot run).
 */
import { launchPage, waitForRollFinished } from './helpers/browser.js';
import { BASE } from './helpers/server.js';

const LOAD_TIMEOUT_MS = 120000;
const SETTLE_TIMEOUT_MS = 180000;
const ROLL =
    'webgl&no-post&fair-dice&test&seed=42424242&dice=d20:1,d6:1&v=1&layout-seed=1&density=med&theme=default';

const fail = (message) => {
    console.error(`FAILURE: ${message}`);
    process.exit(1);
};

const isBenign = (message) =>
    message.includes('404 (Not Found)') || message.includes('dice_physics.js');

async function load(query, { roll }) {
    const { browser, page, errors } = await launchPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    const warnings = [];
    page.on('console', (msg) => msg.type() === 'warning' && warnings.push(msg.text()));
    try {
        await page.goto(`${BASE}/?${query}`, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        await page.waitForFunction(() => window.__app?.ready === true, null, {
            timeout: LOAD_TIMEOUT_MS,
        });
        const wasm = await page.evaluate(() => window.__app?.isWasmAvailable?.() === true);
        if (!wasm) fail('WASM physics not available (run npm run build:wasm)');
        if (roll) await waitForRollFinished(page, { timeout: SETTLE_TIMEOUT_MS });

        const info = await page.evaluate(async (wantFaces) => {
            const app = window.__app;
            const world = await app.physics.exportWorld();
            const has = (name) => !!app.scene.getObjectByName(name);
            return {
                sceneId: app.sceneDocument?.id,
                init: world?.init ?? null,
                staticCount: world?.statics?.length ?? 0,
                worldHash: await app.physics.worldHash?.(),
                present: Object.fromEntries(
                    ['DiceCup', 'DiceTower', 'DiceTray', 'DiceJail'].map((n) => [n, has(n)])
                ),
                tavernHooks: ['lamp', 'gong'].filter((k) => !!app.interactables?.[k]),
                interactables: ['diceCup', 'diceTower', 'diceTray', 'diceJail'].filter(
                    (k) => !!app.interactables?.[k]
                ),
                faces: wantFaces
                    ? app.readAllDiceValues().map((d) => ({ type: d.type, value: d.value }))
                    : null,
            };
        }, roll);
        const fatal = errors.filter((m) => !isBenign(m));
        return { info, fatal, warnings };
    } finally {
        await browser.close();
    }
}

function checkChartRoom({ info, fatal }, label) {
    if (fatal.length) fail(`${label}: browser errors ${JSON.stringify(fatal)}`);
    if (info.sceneId !== 'chart-room') fail(`${label}: scene id was ${info.sceneId}`);
    const { gravity, tableY, tableHalfW, tableHalfD } = info.init ?? {};
    if (gravity !== -15 || tableY !== -2.75 || tableHalfW !== 18 || tableHalfD !== 18) {
        fail(`${label}: engine init did not come from the document: ${JSON.stringify(info.init)}`);
    }
    // TavernWalls and Table predate createProp and are unnamed in the graph, so the
    // tavern shell is told apart by its hooks (lamp, gong) and its wall colliders.
    if (info.tavernHooks.length) fail(`${label}: built tavern props ${info.tavernHooks}`);
    // The Table factory predates createProp and leaves its group unnamed, so the
    // table is checked by what it registers: the rim boxes the engine holds.
    if (info.staticCount < 4) fail(`${label}: engine holds ${info.staticCount} statics`);
    for (const name of ['DiceCup', 'DiceTower', 'DiceTray', 'DiceJail']) {
        if (!info.present[name]) fail(`${label}: missing ${name}`);
    }
    if (info.interactables.length !== 4) {
        fail(`${label}: dice furniture hooks not wired: ${info.interactables}`);
    }
}

(async () => {
    try {
        const a = await load(`scene=chart-room&${ROLL}`, { roll: true });
        checkChartRoom(a, 'chart-room A');
        if (!a.info.faces?.length) fail('chart-room A: no dice faces read after the roll');
        console.log('chart-room A:', JSON.stringify(a.info.faces), a.info.worldHash);

        const b = await load(`scene=chart-room&${ROLL}`, { roll: true });
        checkChartRoom(b, 'chart-room B');
        console.log('chart-room B:', JSON.stringify(b.info.faces), b.info.worldHash);
        if (JSON.stringify(a.info.faces) !== JSON.stringify(b.info.faces)) {
            fail('the seeded throw settled differently on two loads of the same scene');
        }
        if (a.info.worldHash !== b.info.worldHash) fail('same scene, different collider world');

        const t = await load('scene=moon-base&webgl&no-post&fair-dice&test', { roll: false });
        if (t.fatal.length) fail(`fallback: browser errors ${JSON.stringify(t.fatal)}`);
        if (!t.warnings.some((w) => w.includes('Unknown scene "moon-base"'))) {
            fail('fallback: unknown scene id was not logged');
        }
        if (t.info.sceneId !== 'tavern') fail(`fallback: loaded ${t.info.sceneId}, not the tavern`);
        const i = t.info.init ?? { gravity: NaN, tableY: NaN, tableHalfW: NaN, tableHalfD: NaN };
        if (i.gravity !== -15 || i.tableY !== -2.75 || i.tableHalfW !== 18 || i.tableHalfD !== 18) {
            fail(`fallback: tavern init changed: ${JSON.stringify(t.info.init)}`);
        }
        if (t.info.tavernHooks.length !== 2) fail('fallback: the tavern has no lamp / gong');
        if (t.info.staticCount <= a.info.staticCount) {
            fail(
                'fallback: the tavern should hold more colliders (walls, floor) than the chart room'
            );
        }
        if (t.info.worldHash === a.info.worldHash) {
            fail('tavern and chart room hashed to the same collider world');
        }
        console.log('tavern world:', t.info.worldHash, '≠ chart room world:', a.info.worldHash);

        console.log('PASS: ?scene= selects the document; physics, props and replay follow it');
        process.exit(0);
    } catch (err) {
        fail(err.message);
    }
})();
