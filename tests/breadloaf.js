const { runTest } = require('./helpers/browser');
const fs = require('fs');

const url = 'http://localhost:4173/?webgl&no-post&fair-dice&forceProps=BreadLoaf&test';

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

    if (dataUrl) {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync('/home/jules/verification/breadloaf.png', base64Data, 'base64');
        console.log('Saved /home/jules/verification/breadloaf.png via canvas.');
    } else {
        await page.screenshot({ path: '/home/jules/verification/breadloaf.png' });
        console.log('Saved /home/jules/verification/breadloaf.png via page.screenshot.');
    }
});
