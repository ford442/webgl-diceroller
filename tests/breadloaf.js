const { runTest, capturePng } = require('./helpers/browser');
const { BASE } = require('./helpers/server');
const fs = require('fs');

const url = `${BASE}/?webgl&no-post&fair-dice&forceProps=BreadLoaf&test`;

runTest(async (page, _errors) => {
    console.log(`Navigating to ${url} ...`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    console.log('Waiting for the BreadLoaf to register in the scene...');

    // Poll the scene until BreadLoaf is found
    await page.waitForFunction(
        () => {
            const scene = window.__app?.scene;
            if (!scene) return false;
            let found = false;
            scene.traverse((c) => {
                if (c.name === 'BreadLoaf') found = true;
            });
            return found;
        },
        null,
        { timeout: 150000 }
    );

    console.log('✓ BreadLoaf found in scene. Rendering screenshot...');

    const dataUrl = await page.evaluate(() => {
        const app = window.__app;
        const renderer = app?.renderer;
        const scene = app?.scene;
        const camera = app?.camera;
        if (renderer && scene && camera) {
            // Render it explicitly to the canvas
            renderer.render(scene, camera);
            return renderer.domElement.toDataURL('image/png');
        }
        return null;
    });

    // The screenshot is a debugging aid, not the assertion — the scene-graph
    // check above is. Write it beside the repo (BREADLOAF_SHOT overrides) and
    // never fail the test on it; this used to hardcode an absolute path from
    // one contributor's machine, which no other machine has.
    const shotPath = process.env.BREADLOAF_SHOT || 'breadloaf.png';
    try {
        if (dataUrl) {
            fs.writeFileSync(shotPath, dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
        } else {
            await capturePng(page, shotPath);
        }
        console.log(`Saved ${shotPath}`);
    } catch (e) {
        console.log(`(screenshot skipped: ${e.message})`);
    }

    return true;
});
