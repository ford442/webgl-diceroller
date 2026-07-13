const { launchPage } = require('./helpers/browser');

(async () => {
    const { browser, page } = await launchPage({ args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox'] });

    page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

    await page.goto('http://localhost:4173/?no-post', { waitUntil: 'networkidle', timeout: 60000 });

    await page.waitForFunction(() => window.scene !== undefined, { timeout: 60000 });
    console.log('window.scene is defined');

    // Poll every 5 seconds for 60 seconds
    for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(5000);
        const state = await page.evaluate(() => ({
            sceneReady: window.sceneReady,
            sceneChildren: window.scene.children.length
        }));
        console.log(`T+${(i + 1) * 5}s: sceneReady=${state.sceneReady}, children=${state.sceneChildren}`);
        if (state.sceneReady) break;
    }

    await browser.close();
})();
