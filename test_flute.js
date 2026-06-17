const { chromium } = require('playwright');

// E2E: the Flute is present AND interactive (clicking plays a melody).
// `forceProps=Flute` guarantees the randomPool prop spawns regardless of seed.
(async () => {
    console.log("Starting browser...");
    const browser = await chromium.launch({
        args: [
            '--use-gl=swiftshader',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu-shader-disk-cache',
            '--autoplay-policy=no-user-gesture-required'
        ]
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    // ?webgl forces the stable baseline renderer (headless WebGPU init can stall).
    const url = 'http://localhost:4173/?webgl&no-post&forceProps=Flute';
    console.log(`Navigating to ${url} ...`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    console.log("Waiting for the flute interactable to register...");
    // The interactable registers as the prop spawns (mid-load), which is a more
    // reliable signal than window.scene (only exposed after the full load).
    await page.waitForFunction(() => !!(window.__interactables && window.__interactables.flute), null, { timeout: 150000 });

    // Confirm the flute is in the scene graph (window.scene may not be exposed yet).
    const inScene = await page.evaluate(() => {
        if (!window.scene) return 'pending';
        let found = false;
        window.scene.traverse((c) => { if (c.name === 'Flute') found = true; });
        return found;
    });

    // A real user gesture so the AudioContext can resume, then trigger the melody.
    await page.mouse.click(5, 5);
    const result = await page.evaluate(() => {
        const before = window.__interactables.flute.getState().playCount;
        window.__interactables.flute.trigger();
        const after = window.__interactables.flute.getState().playCount;
        return { before, after };
    });

    let pass = true;
    if (inScene === false) { console.error('FAILURE: Flute not found in scene.'); pass = false; }
    else if (inScene === 'pending') console.log('• Flute scene-graph check skipped (window.scene not exposed yet); interactable present');
    else console.log('✓ Flute found in scene');

    if (result.after === result.before + 1) {
        console.log(`✓ Flute interaction fired (playCount ${result.before} → ${result.after})`);
    } else {
        console.error(`FAILURE: flute trigger did not advance playCount (${result.before} → ${result.after})`);
        pass = false;
    }

    if (errors.length) { console.error('FAILURE: page errors:', errors.slice(0, 5)); pass = false; }
    else console.log('✓ No page errors');

    await browser.close();
    console.log(pass ? '\n=== FLUTE TEST PASSED ===' : '\n=== FLUTE TEST FAILED ===');
    process.exit(pass ? 0 : 1);
})();
