#!/usr/bin/env node
/**
 * Benchmark render loop frame times during scripted rolls.
 *
 * Usage:
 *   node scripts/bench-render-loop.mjs
 *   node scripts/bench-render-loop.mjs --query='?webgl&no-post&fair-dice&test&pr=2'
 */
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { startDev } from '../tests/helpers/server.js';

const PORT = 5196;
const DEFAULT_QUERY = '?webgl&fair-dice&test&pr=2';
const SAMPLE_MS = 10000;
const ROLL_SEED = 42424242;

const queryArg = process.argv.find((a) => a.startsWith('--query='));
const QUERY = queryArg ? queryArg.slice('--query='.length) : DEFAULT_QUERY;

const CHROME_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
];

async function main() {
    const vite = await startDev({ port: PORT });
    const BASE = vite.base;
    const browser = await chromium.launch({
        headless: true,
        args: CHROME_ARGS,
    });

    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await page.goto(`${BASE}/${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForFunction(() => window.__app?.ready === true, { timeout: 120000 });

        await page.evaluate((seed) => {
            window.__app?.replayRoll?.(seed);
        }, ROLL_SEED);

        await sleep(500);

        const result = await page.evaluate(async (sampleMs) => {
            const samples = [];
            let motionFrames = 0;
            const start = performance.now();

            while (performance.now() - start < sampleMs) {
                const stats = window.__app?.stats;
                const dt = stats?.lastDeltaTime ?? 0;
                if (dt > 0) samples.push(dt * 1000);
                const post = window.__app?.postConfig;
                if (post?.motionProfileActive) motionFrames += 1;
                await new Promise((r) => requestAnimationFrame(r));
            }

            const governor = window.__app?.stats?.runtimeGovernor;
            const renderer = window.__app?.renderer;
            const drawCalls = renderer?.info?.render?.calls ?? 0;

            const total = samples.length;
            const avgMs = total ? samples.reduce((a, b) => a + b, 0) / total : 0;
            const sorted = [...samples].sort((a, b) => a - b);
            const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;

            return {
                sampleCount: total,
                avgMs,
                p95Ms: p95,
                motionProfilePct: total ? (motionFrames / total) * 100 : 0,
                governor: governor ?? null,
                drawCalls,
            };
        }, SAMPLE_MS);

        const summary = {
            query: QUERY,
            sampleMs: SAMPLE_MS,
            rollSeed: ROLL_SEED,
            ...result,
        };

        console.log(JSON.stringify(summary, null, 2));
    } finally {
        await browser.close();
        await vite.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
