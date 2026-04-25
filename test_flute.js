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

    // Capture console logs
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    console.log("Navigating to http://localhost:5173/?no-post...");
    // Wait until network is idle to ensure scene and scripts load
    await page.goto('http://localhost:5173/?no-post', { waitUntil: 'networkidle', timeout: 60000 });

    console.log("Waiting for scene to be ready...");
    await page.waitForFunction(() => window.scene !== undefined);

    console.log("Waiting for loading overlay to disappear...");
    await page.waitForFunction("() => !document.getElementById('loading-overlay')", { timeout: 60000 });

    console.log("Waiting for window.sceneReady flag...");
    try {
        await page.waitForFunction(() => window.sceneReady === true, { timeout: 10000 });
    } catch (e) {
        console.error("Timeout waiting for sceneReady. Checking if there are console errors that caused init() to abort.");
        const logs = await page.evaluate(() => window.consoleLogs || []);
        console.log("Browser Logs:", logs);
    }

    // Evaluate and recursively search the scene graph
    console.log("Checking for Flute object in the scene...");
    const exists = await page.evaluate(() => {
        let pc = null;
        window.scene.traverse((child) => {
            if (child.name === 'Flute') pc = child;
        });

        if (pc) {
            return {
                found: true,
                position: pc.position,
                childrenCount: pc.children.length
            };
        }

        // Give it a tiny bit more time and check again just in case the scene graph updates
        // actually we can do a set timeout inside the browser context, but let's just wait 1 sec
        // Or actually the scene might be fully loaded. Let's dump the names from the window.scene object.
        let dumpNames = [];
        window.scene.traverse((child) => {
            if (child.name && child.name.length > 0) dumpNames.push(child.name);
        });

        return { found: false, dumpNames };
    });

    if (exists.found) {
        console.log("SUCCESS: Flute object found in the scene!");
        console.log(`Position: Y=${exists.position.y}`);
        console.log(`Children: ${exists.childrenCount}`);
    } else {
        console.error("FAILURE: Flute object not found.");
        console.log("All named objects in scene:", exists.dumpNames);
        process.exitCode = 1;
    }

    await browser.close();
    console.log("Browser closed.");
    process.exit();
})();
