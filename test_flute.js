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
    await page.goto('http://localhost:4173/?no-post', { waitUntil: 'networkidle', timeout: 60000 });

    console.log("Waiting for scene to be ready...");
    await page.waitForFunction(() => window.scene !== undefined, { timeout: 60000 });

    console.log("Waiting for all props to finish loading (window.sceneReady)...");
    await page.waitForFunction(() => window.sceneReady === true, { timeout: 60000 });

    // Evaluate and recursively search the scene graph
    console.log("Checking for Flute object in the scene...");
    const result = await page.evaluate(() => {
        let flute = null;
        const namedObjects = [];

        window.scene.traverse((child) => {
            if (child.name) {
                namedObjects.push(child.name);
            }
            if (child.name === 'Flute') {
                flute = child;
            }
        });

        if (flute) {
            return {
                found: true,
                position: flute.position,
                childrenCount: flute.children.length
            };
        }
        return {
            found: false,
            namedObjects: namedObjects.slice(0, 100) // limit for readability
        };
    });

    if (result.found) {
        console.log("SUCCESS: Flute object found in the scene!");
        console.log(`Position: Y=${result.position.y}`);
        console.log(`Children count: ${result.childrenCount}`);
    } else {
        console.error("FAILURE: Flute object not found.");
        console.error("Named objects in scene (first 100):");
        console.error(result.namedObjects.join(', '));
        process.exitCode = 1;
    }

    await browser.close();
    console.log("Browser closed.");
})();
