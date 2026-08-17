/**
 * Playwright smoke test: dice cup interactable is registered after scene load.
 *
 * Requires preview server with WASM built:
 *   npx vite build   (or npm run build if wasm available)
 *   npm run preview
 *   node tests/dicecup.js
 */
const { chromium } = require('playwright');

const URL = process.env.DICE_URL || 'http://localhost:4173/?webgl&no-post&fair-dice&test';

async function main() {
    const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage();

    await page.goto(URL, { waitUntil: 'networkidle', timeout: 120000 });

    await page.waitForFunction(() => window.__app?.ready === true, null, {
        timeout: 120000,
    });

    const state = await page.evaluate(() => {
        const cup = window.__app?.interactables?.diceCup;
        if (!cup) return { ok: false, reason: 'missing interactable' };
        const snap = cup.getState?.() ?? {};
        return {
            ok: true,
            name: snap.name,
            available: snap.available,
            state: snap.state,
        };
    });

    if (!state.ok) {
        console.error('FAIL:', state.reason);
        process.exit(1);
    }

    console.log('DiceCup interactable OK:', JSON.stringify(state));
    await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
