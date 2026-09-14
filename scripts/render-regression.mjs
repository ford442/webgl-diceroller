#!/usr/bin/env node
// Visual regression capture: golden frames for a fixed layout seed under
// controlled camera + pixel ratio.
//
// Profiles:
//   webgl-nopost  — ?webgl&no-post  (stable, no bloom/vignette)  [REQUIRED]
//   webgl         — ?webgl          (post stack on)              [REQUIRED]
//   webgpu        — ?webgpu         (soft-fail until CI GPUs)    [OPTIONAL]
//
// Usage:
//   node scripts/render-regression.mjs
//   UPDATE_BASELINES=1 node scripts/render-regression.mjs   # also writes tests/baselines/
//   node scripts/render-regression.mjs --update-baselines
//
// Output: render-regression-{profile}.png in cwd (+ JSON summary on stdout).
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { startDev } from '../tests/helpers/server.js';
import { capturePng } from '../tests/helpers/browser.js';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const PORT = 5195;
const LAYOUT_SEED = 4242;
const VIEWPORT = { width: 640, height: 480 };
const CAMERA = { pos: [0, 6, 14], lookAt: [0, 0, 0] };
const BASELINE_DIR = 'tests/baselines';

const UPDATE_BASELINES =
    process.env.UPDATE_BASELINES === '1' || process.argv.includes('--update-baselines');

const CHROME_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
];

/** @type {{ id: string, query: string, required: boolean }[]} */
const PROFILES = [
    {
        id: 'webgl-nopost',
        query: `?webgl&no-post&fair-dice&test&layout-seed=${LAYOUT_SEED}&pr=1`,
        required: true,
    },
    {
        id: 'webgl',
        query: `?webgl&fair-dice&test&layout-seed=${LAYOUT_SEED}&pr=1`,
        required: true,
    },
    {
        id: 'webgpu',
        query: `?webgpu&fair-dice&test&layout-seed=${LAYOUT_SEED}&pr=1`,
        required: false,
    },
];

// CPU-only runners cannot finish a WebGPU load (see AGENTS.md); skipping the
// optional profile there saves minutes of capture that only ever soft-fails.
const ACTIVE_PROFILES =
    process.env.DICE_CI_NO_WEBGPU === '1' ? PROFILES.filter((p) => p.id !== 'webgpu') : PROFILES;

function outFile(id) {
    return `render-regression-${id}.png`;
}

function baselineFile(id) {
    return path.join(BASELINE_DIR, outFile(id));
}

async function stabilizeScene(page) {
    await page
        .waitForFunction(() => window.__app?.scene !== undefined, { timeout: 45000 })
        .catch(() => {});
    await page
        .waitForFunction(() => window.__app?.ready === true, { timeout: 90000 })
        .catch(() => {});

    // Pin camera, strip UI/particles, freeze lights — golden frames should
    // reflect the 3D render path, not HUD chrome or candle flicker.
    await page
        .evaluate(({ pos, lookAt }) => {
            const app = window.__app;
            const sched = app?.scheduler;
            if (sched?.systems) {
                const keep = new Set(['sceneRender', 'frustumCull', 'workerPhysicsFlush']);
                for (const phase of Object.keys(sched.systems)) {
                    for (const sys of sched.systems[phase]) {
                        if (!keep.has(sys.name)) sys.enabled = false;
                    }
                }
            }
            const camera = app?.camera;
            if (camera) {
                camera.position.set(pos[0], pos[1], pos[2]);
                camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
                camera.updateMatrixWorld(true);
            }
            app?.scene?.traverse?.((obj) => {
                const o = /** @type {any} */ (obj);
                if (o.userData?.isDie) o.visible = false;
                if (o.isPoints || o.isSprite) o.visible = false;
                if (o.isAmbientLight) o.intensity = 0.05;
                else if (o.isSpotLight) o.intensity = 5.0;
                else if (o.isPointLight) {
                    // Stable key/fill — ignore per-prop flicker magnitudes.
                    if (o.intensity > 10) o.intensity = 48;
                    else if (o.intensity > 3) o.intensity = 5;
                    else o.intensity = 1.5;
                }
            });
            for (const el of Array.from(document.body.children)) {
                if (el.id === 'canvas-container') continue;
                /** @type {HTMLElement} */ (el).style.setProperty('display', 'none', 'important');
            }
            const container = document.getElementById('canvas-container');
            if (container) {
                for (const el of Array.from(container.children)) {
                    if (el.tagName === 'CANVAS') continue;
                    /** @type {HTMLElement} */ (el).style.setProperty(
                        'display',
                        'none',
                        'important'
                    );
                }
            }
        }, CAMERA)
        .catch(() => {});

    await sleep(800);
}

async function probe(browser, profile) {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    const file = outFile(profile.id);
    // Remove stale candidate so a failed capture cannot look like success.
    try {
        unlinkSync(file);
    } catch {
        /* ok */
    }

    try {
        await page.goto(`${BASE}/${profile.query}`, {
            waitUntil: 'load',
            timeout: 120000,
        });
        await stabilizeScene(page);

        const info = await page
            .evaluate(() => {
                const app = window.__app;
                const r =
                    /** @type {import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer | undefined} */ (
                        app?.renderer ?? undefined
                    );
                const render =
                    /** @type {{ calls?: number; drawCalls?: number; triangles?: number }} */ (
                        r?.info?.render ?? {}
                    );
                const memory = /** @type {{ geometries?: number; textures?: number }} */ (
                    r?.info?.memory ?? {}
                );
                let objects = 0;
                app?.scene?.traverse?.(() => {
                    objects += 1;
                });
                return {
                    rendererType: app?.rendererType ?? null,
                    usingWebGPU: app?.usingWebGPU ?? null,
                    fallbackReason: app?.rendererFallbackReason ?? null,
                    sceneReady: app?.ready === true,
                    sceneChildren: app?.scene?.children?.length ?? null,
                    sceneObjects: objects || null,
                    drawCalls: render.calls ?? render.drawCalls ?? null,
                    triangles: render.triangles ?? null,
                    geometries: memory.geometries ?? null,
                    textures: memory.textures ?? null,
                    frameMs:
                        /** @type {{ timings?: { render?: number } } | null | undefined} */ (
                            app?.stats
                        )?.timings?.render ?? null,
                };
            })
            .catch((e) => ({ error: String(e) }));

        if (!info.sceneReady && profile.required) {
            throw new Error(`scene never became ready for ${profile.id}`);
        }

        await capturePng(page, file);
        if (!existsSync(file)) {
            throw new Error(`screenshot was not written for ${profile.id}`);
        }
        return { ...info, file, errors, captured: true };
    } catch (e) {
        return {
            error: String(e?.message || e),
            file,
            errors,
            captured: false,
            sceneReady: false,
        };
    } finally {
        await page.close();
    }
}

const vite = await startDev({ port: PORT });
const BASE = vite.base;
const browser = await chromium.launch({ args: CHROME_ARGS });
const results = {};
let hardFail = false;

try {
    for (const profile of ACTIVE_PROFILES) {
        console.error(`[capture] ${profile.id} ${profile.query}`);
        const result = await probe(browser, profile);
        results[profile.id] = result;

        if (profile.required) {
            if (!result.captured) {
                console.error(
                    `FAIL: required capture missing for ${profile.id}: ${result.error ?? 'unknown'}`
                );
                hardFail = true;
            } else if (result.sceneReady === false) {
                console.error(`FAIL: sceneReady=false for required profile ${profile.id}`);
                hardFail = true;
            } else if (profile.id.startsWith('webgl') && result.rendererType !== 'webgl') {
                console.error(
                    `FAIL: expected webgl renderer for ${profile.id}, got ${result.rendererType}`
                );
                hardFail = true;
            }
        } else if (!result.captured) {
            console.error(
                `INFO: optional ${profile.id} capture skipped (${result.error ?? 'unavailable'})`
            );
        }
    }

    if (UPDATE_BASELINES) {
        await mkdir(BASELINE_DIR, { recursive: true });
        for (const profile of PROFILES) {
            const src = outFile(profile.id);
            if (!existsSync(src)) continue;
            // Only auto-promote required profiles; WebGPU baselines stay opt-in.
            if (!profile.required && !process.argv.includes('--include-webgpu-baseline')) {
                console.error(
                    `INFO: not promoting optional ${src} (pass --include-webgpu-baseline to force)`
                );
                continue;
            }
            const dest = baselineFile(profile.id);
            await copyFile(src, dest);
            console.error(`[baseline] wrote ${dest}`);
        }
    }

    const report = {
        camera: CAMERA,
        layoutSeed: LAYOUT_SEED,
        viewport: VIEWPORT,
        updateBaselines: UPDATE_BASELINES,
        results,
    };
    console.log(JSON.stringify(report, null, 2));
} finally {
    await Promise.race([browser.close(), sleep(3000)]).catch(() => {});
    await vite.close();
}

if (hardFail) {
    console.error('\nREGRESSION CAPTURE: required profile(s) failed.');
    process.exit(1);
}
console.error('\nOK: required render captures complete.');
process.exit(0);
