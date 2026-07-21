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
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const PORT = 5195;
const BASE = `http://127.0.0.1:${PORT}`;
const LAYOUT_SEED = 4242;
const VIEWPORT = { width: 640, height: 480 };
const CAMERA = { pos: [0, 6, 14], lookAt: [0, 0, 0] };
const BASELINE_DIR = 'tests/baselines';

const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1'
    || process.argv.includes('--update-baselines');

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
        query: `?webgl&no-post&fair-dice&layout-seed=${LAYOUT_SEED}&pr=1`,
        required: true,
    },
    {
        id: 'webgl',
        query: `?webgl&fair-dice&layout-seed=${LAYOUT_SEED}&pr=1`,
        required: true,
    },
    {
        id: 'webgpu',
        query: `?webgpu&fair-dice&layout-seed=${LAYOUT_SEED}&pr=1`,
        required: false,
    },
];

function outFile(id) {
    return `render-regression-${id}.png`;
}

function baselineFile(id) {
    return path.join(BASELINE_DIR, outFile(id));
}

async function startVite() {
    const proc = spawn(
        'npx',
        ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', '--open', 'false'],
        {
            stdio: 'ignore',
            env: { ...process.env, BROWSER: 'none' },
        }
    );
    for (let i = 0; i < 90; i++) {
        await sleep(500);
        try {
            if ((await fetch(`${BASE}/`)).ok) return proc;
        } catch {
            // retry
        }
    }
    proc.kill('SIGKILL');
    throw new Error('vite timeout');
}

async function stabilizeScene(page) {
    await page.waitForFunction(() => window.scene !== undefined, { timeout: 45000 })
        .catch(() => {});
    await page.waitForFunction(() => window.sceneReady === true, { timeout: 90000 })
        .catch(() => {});

    // Pin camera, strip UI/particles, freeze lights — golden frames should
    // reflect the 3D render path, not HUD chrome or candle flicker.
    await page.evaluate(({ pos, lookAt }) => {
        const sched = window.__frameScheduler;
        if (sched?.systems) {
            const keep = new Set(['sceneRender', 'frustumCull', 'workerPhysicsFlush']);
            for (const phase of Object.keys(sched.systems)) {
                for (const sys of sched.systems[phase]) {
                    if (!keep.has(sys.name)) sys.enabled = false;
                }
            }
        }
        if (window.camera) {
            window.camera.position.set(pos[0], pos[1], pos[2]);
            window.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
            window.camera.updateMatrixWorld(true);
        }
        window.scene?.traverse?.((obj) => {
            if (obj.userData?.isDie) obj.visible = false;
            if (obj.isPoints || obj.isSprite) obj.visible = false;
            if (obj.isAmbientLight) obj.intensity = 0.05;
            else if (obj.isSpotLight) obj.intensity = 5.0;
            else if (obj.isPointLight) {
                // Stable key/fill — ignore per-prop flicker magnitudes.
                if (obj.intensity > 10) obj.intensity = 48;
                else if (obj.intensity > 3) obj.intensity = 5;
                else obj.intensity = 1.5;
            }
        });
        for (const el of document.body.children) {
            if (el.id === 'canvas-container') continue;
            el.style.setProperty('display', 'none', 'important');
        }
        const container = document.getElementById('canvas-container');
        if (container) {
            for (const el of container.children) {
                if (el.tagName === 'CANVAS') continue;
                el.style.setProperty('display', 'none', 'important');
            }
        }
    }, CAMERA).catch(() => {});

    await sleep(800);
}

async function capturePng(page, file) {
    // Stop the rAF loop so the compositor isn't fighting a 60fps SwiftShader
    // redraw during screenshot (Playwright can time out waiting for "idle").
    await page.evaluate(() => {
        const r = window.renderer;
        if (!r) return;
        r.setAnimationLoop(null);
        if (window.composer) window.composer.render();
        else if (window.scene && window.camera) r.render(window.scene, window.camera);
    }).catch(() => {});

    const session = await page.context().newCDPSession(page);
    try {
        const { data } = await session.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false,
        });
        try { unlinkSync(file); } catch { /* no prior file */ }
        writeFileSync(file, Buffer.from(data, 'base64'));
    } finally {
        await session.detach().catch(() => {});
    }
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
    try { unlinkSync(file); } catch { /* ok */ }

    try {
        await page.goto(`${BASE}/${profile.query}`, {
            waitUntil: 'load',
            timeout: 120000,
        });
        await stabilizeScene(page);

        const info = await page.evaluate(() => {
            const r = window.renderer;
            const render = r?.info?.render ?? {};
            const memory = r?.info?.memory ?? {};
            let objects = 0;
            window.scene?.traverse?.(() => { objects += 1; });
            return {
                rendererType: window.rendererType ?? null,
                usingWebGPU: window.usingWebGPU ?? null,
                fallbackReason: window.rendererFallbackReason ?? null,
                sceneReady: window.sceneReady ?? false,
                sceneChildren: window.scene?.children?.length ?? null,
                sceneObjects: objects || null,
                drawCalls: render.calls ?? render.drawCalls ?? null,
                triangles: render.triangles ?? null,
                geometries: memory.geometries ?? null,
                textures: memory.textures ?? null,
                frameMs: window.__renderStats?.timings?.render ?? null,
            };
        }).catch((e) => ({ error: String(e) }));

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

const vite = await startVite();
const browser = await chromium.launch({ args: CHROME_ARGS });
const results = {};
let hardFail = false;

try {
    for (const profile of PROFILES) {
        console.error(`[capture] ${profile.id} ${profile.query}`);
        const result = await probe(browser, profile);
        results[profile.id] = result;

        if (profile.required) {
            if (!result.captured) {
                console.error(`FAIL: required capture missing for ${profile.id}: ${result.error ?? 'unknown'}`);
                hardFail = true;
            } else if (result.sceneReady === false) {
                console.error(`FAIL: sceneReady=false for required profile ${profile.id}`);
                hardFail = true;
            } else if (profile.id.startsWith('webgl') && result.rendererType !== 'webgl') {
                console.error(`FAIL: expected webgl renderer for ${profile.id}, got ${result.rendererType}`);
                hardFail = true;
            }
        } else if (!result.captured) {
            console.error(`INFO: optional ${profile.id} capture skipped (${result.error ?? 'unavailable'})`);
        }
    }

    if (UPDATE_BASELINES) {
        await mkdir(BASELINE_DIR, { recursive: true });
        for (const profile of PROFILES) {
            const src = outFile(profile.id);
            if (!existsSync(src)) continue;
            // Only auto-promote required profiles; WebGPU baselines stay opt-in.
            if (!profile.required && !process.argv.includes('--include-webgpu-baseline')) {
                console.error(`INFO: not promoting optional ${src} (pass --include-webgpu-baseline to force)`);
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
    try { vite.kill('SIGKILL'); } catch { /* already dead */ }
}

if (hardFail) {
    console.error('\nREGRESSION CAPTURE: required profile(s) failed.');
    process.exit(1);
}
console.error('\nOK: required render captures complete.');
process.exit(0);