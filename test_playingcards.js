const { chromium } = require('playwright');

// E2E: PlayingCards are present AND interactive (clicking draws/flips a card).
// `forceProps=PlayingCards` guarantees the randomPool prop spawns regardless of seed.
(async () => {
    console.log("Starting browser...");
    const browser = await chromium.launch({
        args: [
            '--use-gl=swiftshader',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu-shader-disk-cache'
        ]
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    // ?webgl forces the stable baseline renderer (headless WebGPU init can stall).
    const url = 'http://localhost:4173/?webgl&no-post&forceProps=PlayingCards';
    console.log(`Navigating to ${url} ...`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    console.log("Waiting for the playingCards interactable to register...");
    await page.waitForFunction(() => !!(window.__interactables && window.__interactables.playingCards), null, { timeout: 150000 });

    const inScene = await page.evaluate(() => {
        if (!window.scene) return { found: 'pending' };
        let found = null;
        window.scene.traverse((c) => { if (c.name === 'PlayingCards') found = c; });
        return found ? { found: true, children: found.children.length } : { found: false };
    });

    // Draw a couple of cards and confirm state advances + a card face is revealed.
    const result = await page.evaluate(() => {
        const api = window.__interactables.playingCards;
        const before = api.getState().draws;
        api.trigger();
        api.trigger();
        const state = api.getState();
        return { before, after: state.draws, lastCard: state.lastCard, cardCount: state.cardCount };
    });

    let pass = true;
    if (inScene.found === false) { console.error('FAILURE: PlayingCards not found in scene.'); pass = false; }
    else if (inScene.found === 'pending') console.log('• PlayingCards scene-graph check skipped (window.scene not exposed yet); interactable present');
    else console.log(`✓ PlayingCards found (${inScene.children} children)`);

    if (result.after === result.before + 2) {
        console.log(`✓ Card draws advanced (${result.before} → ${result.after})`);
    } else {
        console.error(`FAILURE: draws did not advance (${result.before} → ${result.after})`);
        pass = false;
    }

    if (result.lastCard && result.lastCard.rank && result.lastCard.suit) {
        console.log(`✓ Revealed a card: ${result.lastCard.rank}${result.lastCard.suit}`);
    } else {
        console.error('FAILURE: no card revealed after draw.');
        pass = false;
    }

    if (errors.length) { console.error('FAILURE: page errors:', errors.slice(0, 5)); pass = false; }
    else console.log('✓ No page errors');

    await browser.close();
    console.log(pass ? '\n=== PLAYING CARDS TEST PASSED ===' : '\n=== PLAYING CARDS TEST FAILED ===');
    process.exit(pass ? 0 : 1);
})();
