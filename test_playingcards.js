const { chromium } = require('playwright');

(async () => {
    console.log("Starting browser...");
    const browser = await chromium.launch({
        args: ['--use-gl=swiftshader']
    });
    const page = await browser.newPage();

    console.log("Navigating to http://localhost:5173/?no-post...");
    // Wait until network is idle to ensure scene and scripts load
    await page.goto('http://localhost:5173/?no-post', { waitUntil: 'networkidle' });

    console.log("Waiting for scene to be ready...");
    await page.waitForFunction(() => window.scene !== undefined);

    // Give it a brief moment for asynchronous initialization (like Ammo.js)
    await page.waitForTimeout(1000);

    console.log("Checking for PlayingCards object in the scene...");
    const exists = await page.evaluate(() => {
        const obj = window.scene.getObjectByName('PlayingCards');
        if (obj) {
            return {
                found: true,
                position: obj.position,
                childrenCount: obj.children.length
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
