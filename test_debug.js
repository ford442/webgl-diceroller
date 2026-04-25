const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({
        args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

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
        console.log(`T+${(i+1)*5}s: sceneReady=${state.sceneReady}, children=${state.sceneChildren}`);
        if (state.sceneReady) break;
    }

    await browser.close();
})();
