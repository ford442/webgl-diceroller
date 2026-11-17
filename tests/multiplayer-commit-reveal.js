/**
 * Two-client commit-reveal soak: a host and a guest in one signaling room
 * (protocol v2, the only protocol) must settle the same faces for
 *   1. a whole-table throw, and
 *   2. a partial throw — the host holds one die in the jail and presses R,
 *      so the commitment binds the thrown slots.
 * It also checks that a client announcing protocol v1 is refused with a
 * readable `protocol_version_mismatch` frame rather than admitted.
 *
 * Prereqs (not run in CI — the runners have no signaling worker):
 *   npm run build:wasm && npm run build:js
 *   npm --prefix signaling install && npm run signal:dev   # :8787
 *   npm run test:multiplayer-commit-reveal
 *
 * SIGNAL_URL overrides the worker (default http://127.0.0.1:8787).
 */
import { launchPage, waitForRollFinished } from './helpers/browser.js';
import { startPreview } from './helpers/server.js';

const SIGNAL_URL = process.env.SIGNAL_URL || 'http://127.0.0.1:8787';
// Same table on both clients: the room compares world hashes at join.
const TABLE = 'layout-seed=1&density=med&theme=default';
const QUERY = `?webgl&no-post&test&${TABLE}&signal=${encodeURIComponent(SIGNAL_URL)}`;
const LOAD_TIMEOUT_MS = 180000;
const ROLL_TIMEOUT_MS = 180000;

async function open(url, label) {
    const { browser, page, errors } = await launchPage({ logConsole: false });
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    // Two software-rendered tavern pages on one machine: keep the canvas
    // small so neither starves the other (a dice GLB that misses its 15 s
    // load window spawns no die, and that client then has nothing to roll).
    await page.setViewportSize({ width: 480, height: 320 });
    page.on('console', (msg) => {
        const text = msg.text();
        if (/RoomSession|Multiplayer|Signaling|commit|Roll|error|Timeout loading/i.test(text)) {
            console.log(`[${label}] ${text}`);
        }
    });
    await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
    await page.waitForFunction(() => /** @type {any} */ (window).__app?.ready === true, null, {
        timeout: LOAD_TIMEOUT_MS,
    });
    if (
        !(await page.evaluate(() => /** @type {any} */ (window).__app.isWasmAvailable?.() === true))
    ) {
        throw new Error(`${label}: WASM physics not available (npm run build:wasm)`);
    }
    return { browser, page, errors, label };
}

const faces = (page) =>
    page.evaluate(() =>
        /** @type {any} */ (window).__app.readAllDiceValues().map((d) => `${d.type}=${d.value}`)
    );

const roomState = (page) =>
    page.evaluate(() => /** @type {any} */ (window).__app.multiplayer?.getState?.() ?? null);

async function refusesV1() {
    const { code } = await (await fetch(`${SIGNAL_URL}/rooms`, { method: 'POST' })).json();
    const wsBase = SIGNAL_URL.replace(/^http/, 'ws');
    const frame = (params) =>
        new Promise((resolve) => {
            const ws = new WebSocket(`${wsBase}/rooms/${code}?${new URLSearchParams(params)}`);
            ws.onmessage = (e) => {
                resolve(JSON.parse(e.data));
                ws.close();
            };
            ws.onerror = () => resolve({ wsError: true });
        });
    const host = new WebSocket(
        `${wsBase}/rooms/${code}?${new URLSearchParams({ peerId: 'h', role: 'host', protocolVersion: '2' })}`
    );
    await new Promise((r) => (host.onmessage = r));
    const refused = await frame({ peerId: 'g', role: 'guest', protocolVersion: '1' });
    host.close();
    return refused;
}

const rollState = (page) =>
    page.evaluate(() => {
        const s = /** @type {any} */ (window).__app.getRollState();
        return `${s.phase} started=${s.startedCount} settled=${s.settledCount}`;
    });

/**
 * Press R on the host and wait for that roll to finish on every client (each
 * against its own count from before the press), logging each side's roll
 * state as it goes.
 */
async function rollAndWait(clients) {
    const base = await Promise.all(
        clients.map((c) => c.page.evaluate(() => /** @type {any} */ (window).__app.getRollState()))
    );
    await clients[0].page.keyboard.press('KeyR');
    const timer = setInterval(async () => {
        const states = await Promise.all(clients.map((c) => rollState(c.page).catch(() => '?')));
        console.log(`  … ${clients.map((c, i) => `${c.label}: ${states[i]}`).join(' | ')}`);
    }, 15000);
    try {
        return await Promise.all(
            clients.map((c, i) =>
                waitForRollFinished(c.page, {
                    minFinished: base[i].settledCount + 1,
                    timeout: ROLL_TIMEOUT_MS,
                }).catch((e) => {
                    throw new Error(`${c.label}: ${e.message}`);
                })
            )
        );
    } finally {
        clearInterval(timer);
    }
}

(async () => {
    const health = await fetch(`${SIGNAL_URL}/health`).catch(() => null);
    if (!health?.ok) {
        console.error(`FAIL: no signaling worker at ${SIGNAL_URL} (npm run signal:dev)`);
        process.exit(1);
    }

    const refused = await refusesV1();
    console.log('v1 join →', JSON.stringify(refused));
    if (refused.error !== 'protocol_version_mismatch') {
        console.error('FAIL: a v1 client was not refused with protocol_version_mismatch');
        process.exit(1);
    }

    const server = await startPreview();
    const opened = [];
    try {
        const host = await open(server.url(`/${QUERY}`), 'host');
        opened.push(host);
        const { code } = await host.page.evaluate(() =>
            /** @type {any} */ (window).__app.multiplayer.createAndHost()
        );
        console.log(`Host opened room ${code}`, JSON.stringify(await roomState(host.page)));

        const guest = await open(server.url(`/${QUERY}&room=${code}`), 'guest');
        opened.push(guest);
        await guest.page.waitForFunction(
            () =>
                /** @type {any} */ (window).__app.multiplayer?.getState?.().status === 'connected',
            null,
            { timeout: LOAD_TIMEOUT_MS }
        );
        console.log('Guest', JSON.stringify(await roomState(guest.page)));
        const counts = await Promise.all([faces(host.page), faces(guest.page)]);
        if (!counts[0].length || counts[0].length !== counts[1].length) {
            throw new Error(
                `dice on the table differ before any roll (host ${counts[0].length}, guest ` +
                    `${counts[1].length}) — a client's dice models did not load`
            );
        }

        let pass = true;

        // 1. Whole-table throw.
        await rollAndWait([host, guest]);
        const a = await Promise.all([faces(host.page), faces(guest.page)]);
        console.log('throw   host :', a[0].join(' '));
        console.log('throw   guest:', a[1].join(' '));
        if (JSON.stringify(a[0]) !== JSON.stringify(a[1])) {
            console.error('FAIL: whole-table throw diverged');
            pass = false;
        }

        // 2. Partial throw: hold the first die, then R throws the rest.
        const held = await host.page.evaluate(() => {
            const engine = /** @type {any} */ (window).__app.getWasmEngine();
            const id = Math.round(Array.from(engine.getDieIds())[0]);
            /** @type {any} */ (window).__app.interactables.diceJail.hold([id]);
            return /** @type {any} */ (window).__app.interactables.diceJail.getState().heldIds;
        });
        await rollAndWait([host, guest]);
        const b = await Promise.all([faces(host.page), faces(guest.page)]);
        console.log(`partial host : (held id ${held})`, b[0].join(' '));
        console.log('partial guest:', b[1].join(' '));
        if (JSON.stringify(b[0]) !== JSON.stringify(b[1])) {
            console.error('FAIL: partial throw diverged');
            pass = false;
        }

        const guestState = await roomState(guest.page);
        if (guestState?.status !== 'connected') {
            console.error('FAIL: guest left the connected state:', JSON.stringify(guestState));
            pass = false;
        }
        console.log(pass ? 'PASS' : 'FAIL');
        process.exitCode = pass ? 0 : 1;
    } catch (e) {
        console.error('FAILURE:', e.message);
        process.exitCode = 1;
    } finally {
        for (const o of opened) await o.browser.close();
        await server.close();
    }
})();
