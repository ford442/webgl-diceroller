#!/usr/bin/env node
/**
 * Service worker install + crossOriginIsolated must remain true with COOP/COEP
 * preview headers (SharedArrayBuffer / worker-physics fast path).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4178;
const BASE = `http://127.0.0.1:${PORT}`;

async function startPreview() {
    const proc = spawn(
        'npx',
        ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    for (let i = 0; i < 120; i++) {
        await sleep(500);
        try {
            if ((await fetch(`${BASE}/`)).ok) return proc;
        } catch {
            // retry
        }
    }
    proc.kill('SIGKILL');
    throw new Error('preview server did not start');
}

const preview = await startPreview();
let failed = 0;

try {
    const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    const page = await browser.newPage();

    await page.goto(`${BASE}/?webgl&no-post&fair-dice`, { waitUntil: 'networkidle', timeout: 120000 });

    const beforeSw = await page.evaluate(() => ({
        isolated: window.crossOriginIsolated === true,
        coop: document.querySelector('meta[http-equiv="Cross-Origin-Opener-Policy"]')?.content ?? null
    }));

    if (!beforeSw.isolated) {
        failed += 1;
        console.error('FAIL: crossOriginIsolated false before service worker');
    } else {
        console.log('ok: crossOriginIsolated true on first load');
    }

    // Wait for vite-plugin-pwa registration (auto-injected).
    await page.waitForFunction(
        () => 'serviceWorker' in navigator && navigator.serviceWorker.controller != null,
        null,
        { timeout: 60000 }
    ).catch(() => {
        failed += 1;
        console.error('FAIL: service worker did not take control within 60s');
    });

    await page.reload({ waitUntil: 'networkidle' });

    const afterSw = await page.evaluate(() => ({
        isolated: window.crossOriginIsolated === true,
        swControlled: navigator.serviceWorker.controller != null
    }));

    if (!afterSw.swControlled) {
        failed += 1;
        console.error('FAIL: page not controlled by service worker after reload');
    } else {
        console.log('ok: service worker controls the page after reload');
    }

    if (!afterSw.isolated) {
        failed += 1;
        console.error('FAIL: crossOriginIsolated false after service-worker reload');
    } else {
        console.log('ok: crossOriginIsolated still true after service-worker reload');
    }

    await browser.close();
} finally {
    preview.kill('SIGTERM');
}

if (failed > 0) {
    console.error(`\n${failed} PWA isolation check(s) failed`);
    process.exit(1);
}

console.log('\nPWA isolation checks passed.');
