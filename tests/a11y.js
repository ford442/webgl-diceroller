const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const DEFAULT_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
];

const url = 'http://localhost:4173/?webgl&no-post&fair-dice';

(async () => {
    const browser = await chromium.launch({ headless: true, args: DEFAULT_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    try {
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 150000 });

        const liveRegion = await page.$('#dice-results-live');
        if (!liveRegion) {
            console.error('FAILURE: #dice-results-live aria-live region missing');
            process.exit(1);
        }

        const liveAttrs = await liveRegion.evaluate((el) => ({
            ariaLive: el.getAttribute('aria-live'),
            role: el.getAttribute('role')
        }));
        if (liveAttrs.ariaLive !== 'polite' || liveAttrs.role !== 'status') {
            console.error('FAILURE: aria-live region has wrong attributes', liveAttrs);
            process.exit(1);
        }
        console.log('✓ aria-live results region present');

        const focusables = await page.evaluate(() => {
            const panel = document.getElementById('dice-controls-panel');
            if (!panel) return { panel: false, count: 0 };
            const items = panel.querySelectorAll('input, select, button');
            return { panel: true, count: items.length };
        });
        if (!focusables.panel || focusables.count < 3) {
            console.error('FAILURE: dice controls panel missing or too few focusable elements', focusables);
            process.exit(1);
        }
        console.log(`✓ ${focusables.count} focusable dice controls`);

        const axeResults = await new AxeBuilder({ page })
            .include('#dice-controls-panel')
            .include('#dice-hud-panel')
            .include('#dice-results-live')
            .include('#roll-history-toggle')
            .disableRules(['color-contrast'])
            .analyze();

        const violations = axeResults.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        if (violations.length > 0) {
            console.error('FAILURE: axe violations on DOM UI');
            for (const v of violations) {
                console.error(`  [${v.impact}] ${v.id}: ${v.help}`);
                for (const node of v.nodes.slice(0, 3)) {
                    console.error(`    → ${node.target.join(' ')}`);
                }
            }
            process.exit(1);
        }
        console.log(`✓ axe scan passed (${axeResults.passes.length} rules; color-contrast excluded — scrim work tracked separately)`);

        if (errors.length > 0) {
            console.error('FAILURE: browser console errors during load');
            process.exit(1);
        }

        console.log('PASS: accessibility smoke test');
        process.exit(0);
    } catch (e) {
        console.error('FAILURE:', e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();

