#!/usr/bin/env node
/**
 * Boot budget: load `/` cold, then warm, and fail if the renderer's main thread
 * is ever blocked for longer than a budget between navigation and `ready`.
 *
 * Why this exists (#365): a warm-cache second visit used to run tier 0 and its
 * shader compiles back to back — every `await` in the boot chain resolved from
 * cache without ever yielding to the event loop — so the main thread was blocked
 * for 40–140 s on SwiftShader before the window `load` event. A laptop iGPU
 * shows the same thing as a visible freeze ("the page hangs when I refresh").
 * Nothing measured it, so nothing caught it.
 *
 * What it records, per visit:
 *   - `PerformanceObserver('longtask')` from the first script (an init script),
 *     which is what the budget is checked against;
 *   - a Chromium trace of the main thread (`blink.user_timing` carries the app's
 *     own `boot:*` measures, so the tiers, props and compiles show up on the
 *     timeline next to the tasks they made long) saved as a Perfetto /
 *     DevTools-loadable JSON;
 *   - `__app.bootTrace()` (tiers, props, compiles, first frame) when the build has it;
 *   - navigation → `load` and navigation → `ready` wall times.
 *
 * Environment:
 *   BOOT_TASK_BUDGET_MS   longest allowed main-thread task (default 2000, generous: SwiftShader)
 *   BOOT_LOAD_BUDGET_MS   longest allowed navigation → `load` event (default 60000)
 *   BOOT_BUDGET_QUERY     query string to load (default `?test`: the default route; software
 *                         WebGL on a GPU-less runner picks the classic renderer itself)
 *   BOOT_BUDGET_OUT       where the report + traces go (default ./boot-budget)
 *   BOOT_BUDGET_OUT_DIR   serve this build instead of dist/ (e.g. a "before" build)
 *   BOOT_BUDGET_PORT      preview port (default 4178)
 *   BOOT_BUDGET_VISITS    `cold,warm` (default) — or just `cold`
 *
 * Prereq: a build in dist/ (`npm run build:js`). Needs WASM only for dice; the
 * tavern boots to `ready` without it.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { startPreview } from '../tests/helpers/server.js';
import { DEFAULT_ARGS, leaveAndWaitForGpuQuiet } from '../tests/helpers/browser.js';

const BUDGET_MS = Number(process.env.BOOT_TASK_BUDGET_MS ?? 2000);
const LOAD_BUDGET_MS = Number(process.env.BOOT_LOAD_BUDGET_MS ?? 60000);
const QUERY = process.env.BOOT_BUDGET_QUERY ?? '?test';
const OUT = path.resolve(process.env.BOOT_BUDGET_OUT ?? 'boot-budget');
const PORT = Number(process.env.BOOT_BUDGET_PORT ?? 4178);
const VISITS = (process.env.BOOT_BUDGET_VISITS ?? 'cold,warm').split(',').map((s) => s.trim());
const REPORT_ONLY = process.env.BOOT_BUDGET_REPORT_ONLY === '1';
const READY_TIMEOUT_MS = Number(process.env.BOOT_BUDGET_READY_TIMEOUT_MS ?? 300000);
/** Frames after `ready` to wait for, so the first frame the player sees is inside the window. */
const SETTLE_AFTER_READY_MS = 1500;

/** Installed before any page script: longtask entries are buffered from navigation start. */
function installLongTaskObserver() {
    window.__bootLongTasks = [];
    try {
        new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
                window.__bootLongTasks.push({
                    start: e.startTime,
                    duration: e.duration,
                    name: e.name,
                });
            }
        }).observe({ type: 'longtask', buffered: true });
    } catch {
        window.__bootLongTasksUnsupported = true;
    }
}

const fmt = (ms) => `${(ms / 1000).toFixed(2)} s`;

async function visit(page, browser, label, url) {
    fs.mkdirSync(OUT, { recursive: true });
    const tracePath = path.join(OUT, `trace-${label}.json`);
    const errors = [];
    const wasmRequests = [];
    const onError = (err) => errors.push(err.message);
    const onRequest = (req) => {
        if (/dice_physics\.wasm(\?|$)/.test(req.url())) wasmRequests.push(req.url());
    };
    page.on('pageerror', onError);
    page.on('request', onRequest);

    // The warm visit re-navigates the page the cold one used (through about:blank,
    // like a refresh): the shape that blocked for 40-300 s on SwiftShader, which a
    // fresh tab does not reproduce. That wait is the GPU process still tearing the
    // previous document's WebGL context down (Chromium's cleanup, not boot work), so
    // it is waited out *before* tracing starts and reported on its own line, rather
    // than blamed on the page or hidden. See leaveAndWaitForGpuQuiet.
    let gpuQuietMs = null;
    if (page.url() !== 'about:blank') gpuQuietMs = await leaveAndWaitForGpuQuiet(page);
    else await page.goto('about:blank');

    await browser.startTracing(page, {
        path: tracePath,
        // `disabled-by-default-devtools.timeline` is what carries RunTask; user_timing
        // carries performance.measure(), i.e. the app's own boot spans.
        categories: [
            'devtools.timeline',
            'disabled-by-default-devtools.timeline',
            'blink.user_timing',
        ],
    });

    const started = Date.now();
    let loadMs = null;
    const onLoad = () => {
        loadMs = Date.now() - started;
    };
    page.once('load', onLoad);
    // `commit`, not `load`: a blocked main thread would otherwise burn the goto
    // timeout and hide *what* was slow behind "Timeout 120000ms exceeded". `load`
    // is timed separately above and judged against BOOT_LOAD_BUDGET_MS.
    await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction(() => window.__app?.ready === true, null, {
        timeout: READY_TIMEOUT_MS,
        polling: 500,
    });
    const readyMs = Date.now() - started;
    await page.waitForTimeout(SETTLE_AFTER_READY_MS);

    const data = await page.evaluate(() => ({
        longTasks: window.__bootLongTasks ?? [],
        unsupported: window.__bootLongTasksUnsupported === true,
        bootTrace: typeof window.__app?.bootTrace === 'function' ? window.__app.bootTrace() : null,
        navigation: (() => {
            const nav = performance.getEntriesByType('navigation')[0];
            return nav
                ? {
                      domContentLoaded: nav.domContentLoadedEventEnd,
                      load: nav.loadEventEnd,
                      responseEnd: nav.responseEnd,
                  }
                : null;
        })(),
        readyAt: performance.now(),
    }));
    await browser.stopTracing().catch(() => {});
    page.off('pageerror', onError);
    page.off('request', onRequest);
    page.off('load', onLoad);

    const tasks = data.longTasks.slice().sort((a, b) => b.duration - a.duration);
    const total = tasks.reduce((sum, t) => sum + t.duration, 0);
    return {
        label,
        url,
        readyMs,
        loadMs,
        navigation: data.navigation,
        longest: tasks[0] ?? null,
        count: tasks.length,
        blockedMs: total,
        top: tasks.slice(0, 8),
        longTasksUnsupported: data.unsupported,
        bootTrace: data.bootTrace,
        wasmRequests: wasmRequests.length,
        gpuQuietMs,
        errors,
        tracePath,
    };
}

function describeTrace(trace) {
    if (!trace) return ['  (this build has no __app.bootTrace())'];
    const lines = [];
    for (const t of trace.tiers ?? []) {
        lines.push(
            `  ${t.name.padEnd(14)} ${fmt(t.duration).padStart(9)}  ` +
                `props=${t.props ?? 0} longest-prop=${Math.round(t.longestPropMs ?? 0)}ms ` +
                `yields=${t.yields ?? 0}`
        );
    }
    if (trace.compile) {
        lines.push(
            `  compile        total=${Math.round(trace.compile.totalMs)}ms ` +
                `longest=${Math.round(trace.compile.longestMs)}ms ` +
                `programs=${trace.compile.programs ?? '?'}`
        );
    }
    if (trace.firstFrame) {
        lines.push(
            `  first frame    at ${fmt(trace.firstFrame.at)}  ` +
                `(${Math.round(trace.firstFrame.duration)}ms, ` +
                `${trace.firstFrame.newPrograms ?? '?'} new programs)`
        );
    }
    return lines;
}

function judge(result) {
    const problems = [];
    if (result.longTasksUnsupported) problems.push('longtask observer unsupported');
    if (result.longest && result.longest.duration > BUDGET_MS) {
        problems.push(
            `longest main-thread task ${Math.round(result.longest.duration)} ms ` +
                `(at ${fmt(result.longest.start)}) exceeds the ${BUDGET_MS} ms budget`
        );
    }
    if (result.loadMs === null) {
        problems.push('window `load` never fired before `ready`');
    } else if (result.loadMs > LOAD_BUDGET_MS) {
        problems.push(
            `navigation → load took ${fmt(result.loadMs)} (budget ${fmt(LOAD_BUDGET_MS)})`
        );
    }
    return problems;
}

const preview = await startPreview({
    port: PORT,
    outDir: process.env.BOOT_BUDGET_OUT_DIR || undefined,
});
let failed = false;
const results = [];
try {
    const browser = await chromium.launch({ args: DEFAULT_ARGS });
    try {
        // One page for both visits: the second is warm on the HTTP cache, the
        // service worker and the compiled-module cache, like a real refresh.
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(installLongTaskObserver);
        const url = `${preview.base}/${QUERY}`;
        for (const label of VISITS) {
            console.log(`\n== ${label} visit: ${url}`);
            const result = await visit(page, browser, label, url);
            results.push(result);
            console.log(
                `navigation → ready ${fmt(result.readyMs)}, → load ` +
                    (result.loadMs === null ? 'never' : fmt(result.loadMs))
            );
            console.log(
                `long tasks: ${result.count} (blocked ${fmt(result.blockedMs)} in total); ` +
                    `longest ${result.longest ? Math.round(result.longest.duration) : 0} ms ` +
                    `at ${result.longest ? fmt(result.longest.start) : '-'}`
            );
            for (const t of result.top.slice(0, 5)) {
                console.log(
                    `    ${String(Math.round(t.duration)).padStart(7)} ms  @ ${fmt(t.start)}`
                );
            }
            for (const line of describeTrace(result.bootTrace)) console.log(line);
            console.log(`dice_physics.wasm requests: ${result.wasmRequests}`);
            if (result.gpuQuietMs !== null) {
                console.log(
                    `waited ${fmt(result.gpuQuietMs)} for the GPU process to finish tearing down ` +
                        'the previous document (software rasterizer; not counted against the budget)'
                );
            }
            if (result.errors.length) console.log(`page errors: ${result.errors.length}`);
            const problems = judge(result);
            result.problems = problems;
            for (const p of problems) console.error(`FAIL (${label}): ${p}`);
            if (problems.length) failed = true;
        }
        await context.close();
    } finally {
        await browser.close();
    }
} finally {
    await preview.close();
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
    path.join(OUT, 'report.json'),
    JSON.stringify(
        { budgetMs: BUDGET_MS, loadBudgetMs: LOAD_BUDGET_MS, query: QUERY, results },
        null,
        2
    )
);
console.log(`\nreport + traces in ${OUT}`);

if (failed && !REPORT_ONLY) {
    process.exit(1);
}
console.log(failed ? '\n(report-only: not failing)' : '\nBoot budget: ok');
