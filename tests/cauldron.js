const { runTest } = require('./helpers/browser');

// Using required params as noted in the agent docs: ?webgl&no-post&fair-dice
const url = 'http://localhost:4173/?webgl&no-post&fair-dice&forceProps=Cauldron';

runTest(async (page, errors) => {
    console.log(`Navigating to ${url} ...`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    console.log('Waiting for scene to be ready...');
    await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 150000 });

    const inScene = await page.evaluate(() => {
        if (!window.scene) return false;
        let found = false;
        window.scene.traverse((c) => { if (c.name === 'Cauldron') found = true; });
        return found;
    });

    let pass = true;
    if (!inScene) {
        console.error('FAILURE: Cauldron not found in scene.');
        pass = false;
    } else {
        console.log('✓ Cauldron found in scene');
    }

    if (errors.length) { console.error('FAILURE: page errors:', errors.slice(0, 5)); pass = false; }
    else console.log('✓ No page errors');

    console.log(pass ? '\n=== CAULDRON TEST PASSED ===' : '\n=== CAULDRON TEST FAILED ===');
    return pass;
}, { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu-shader-disk-cache'], logConsole: false });
