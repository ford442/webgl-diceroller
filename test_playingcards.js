const { chromium } = require('playwright');

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

    console.log("Navigating to http://localhost:4173/?no-post...");
    // Wait until network is idle to ensure scene and scripts load
    await page.goto('http://localhost:4173/?no-post', { waitUntil: 'networkidle', timeout: 60000 });

    console.log("Waiting for scene to be ready...");
    await page.waitForFunction(() => window.scene !== undefined);

    console.log("Waiting for loading overlay to disappear...");
    await page.waitForFunction("() => !document.getElementById('loading-overlay')", { timeout: 60000 });

    // Evaluate and recursively search the scene graph
    console.log("Checking for PlayingCards object in the scene...");
    const exists = await page.evaluate(() => {
        let pc = null;
        window.scene.traverse((child) => {
            if (child.name === 'PlayingCards') pc = child;
        });

        if (pc) {
            return {
                found: true,
                position: pc.position,
                childrenCount: pc.children.length
            };
        }
        return { found: false };
    });

    if (exists.found) {
        console.log("SUCCESS: PlayingCards object found in the scene!");
        console.log(`Position: Y=${exists.position.y}`);
        console.log(`Children (cards/deck): ${exists.childrenCount}`);
    } else {
        console.error("FAILURE: PlayingCards object not found.");
        process.exitCode = 1;
    }

    await browser.close();
    console.log("Browser closed.");
})();
