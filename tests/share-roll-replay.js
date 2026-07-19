/**
 * Playwright smoke test: two page loads with the same shareable-roll URL
 * must produce identical readAllDiceValues() output after settlement.
 *
 * Prereq: npx vite build && npm run preview
 */
const { launchPage } = require('./helpers/browser');

const BASE = 'http://localhost:4173';
const REPLAY_QUERY = '?webgl&no-post&fair-dice&seed=42424242&dice=d20:1,d6:1&v=1';
const LOAD_TIMEOUT_MS = 120000;
const SETTLE_TIMEOUT_MS = 180000;

async function waitForReplaySettled(page) {
    await page.waitForFunction(() => window.sceneReady === true, { timeout: LOAD_TIMEOUT_MS });
    const wasmReady = await page.evaluate(() => window.isWasmAvailable?.() === true);
    if (!wasmReady) {
        return { skipped: true, reason: 'WASM physics not available (run npm run build:wasm)' };
    }
    await page.waitForFunction(
        () => typeof window.areDiceSettled === 'function' && window.areDiceSettled() === true,
        { timeout: SETTLE_TIMEOUT_MS }
    );
    await page.waitForTimeout(500);
    return { skipped: false };
}

function isBenignBrowserError(message) {
    return message.includes('404 (Not Found)') || message.includes('dice_physics.js');
}

async function captureReplayValues(page) {
    return page.evaluate(() =>
        window.readAllDiceValues().map((die) => ({ type: die.type, value: die.value }))
    );
}

(async () => {
    const { browser, page, errors } = await launchPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    const url = `${BASE}/${REPLAY_QUERY}`;

    try {
        console.log(`Opening replay URL: ${url}`);

        await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        const settleA = await waitForReplaySettled(page);
        if (settleA.skipped) {
            console.log(`SKIP: ${settleA.reason}`);
            process.exit(0);
        }
        const runA = await captureReplayValues(page);

        await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        const settleB = await waitForReplaySettled(page);
        if (settleB.skipped) {
            console.log(`SKIP: ${settleB.reason}`);
            process.exit(0);
        }
        const runB = await captureReplayValues(page);

        console.log('Run A:', JSON.stringify(runA));
        console.log('Run B:', JSON.stringify(runB));

        const fatalErrors = errors.filter((message) => !isBenignBrowserError(message));
        if (fatalErrors.length) {
            console.error('Browser errors:', fatalErrors);
            process.exit(1);
        }

        if (!runA.length || !runB.length) {
            console.error('FAILURE: expected dice values on the table');
            process.exit(1);
        }

        const identical = JSON.stringify(runA) === JSON.stringify(runB);
        if (!identical) {
            console.error('FAILURE: replay values differ between runs');
            process.exit(1);
        }

        console.log('PASS: identical replay results across two page loads');
        process.exit(0);
    } catch (err) {
        console.error('FAILURE:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
