const { chromium } = require('playwright');

const DEFAULT_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
];

// Launches headless Chromium with the swiftshader flags these verify scripts
// need, and wires up console/page error collection into a shared `errors`
// array (mutated in place as events arrive, readable at any point).
async function launchPage(opts = {}) {
    const browser = await chromium.launch({
        headless: opts.headless ?? true,
        args: opts.args ?? DEFAULT_ARGS,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
            if (opts.logConsole !== false) console.log(`[BROWSER ERROR] ${msg.text()}`);
        }
    });
    page.on('pageerror', (err) => {
        errors.push(err.message);
        if (opts.logConsole !== false) console.log(`[PAGE ERROR] ${err.message}`);
    });
    return { browser, page, errors };
}

// Runs `fn(page, errors)`, always closes the browser, and exits the process
// with 0/1 based on the boolean it returns — the common tail of every script.
async function runTest(fn, opts = {}) {
    const { browser, page, errors } = await launchPage(opts);
    try {
        const pass = await fn(page, errors);
        process.exit(pass ? 0 : 1);
    } catch (e) {
        console.error('FAILURE:', e.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

module.exports = { launchPage, runTest, DEFAULT_ARGS };
