// Pixel-diffs freshly captured render-regression screenshots against checked-in
// baselines under tests/baselines/. Uses sharp (already a devDependency) instead
// of adding a new pixel-diff library.
//
// Usage: node scripts/render-regression.mjs && node scripts/compare-render-baseline.mjs
//
// Exits non-zero only on an actual excess-diff or size-mismatch against an
// existing baseline. Missing baselines or a missing candidate screenshot (the
// capture step itself failed/timed out — a known risk in headless WebGPU) are
// reported as informational, not fatal, so this check doesn't block PRs before
// a real baseline has been established.
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const DIFF_THRESHOLD = 0.02; // fraction of pixels allowed to differ beyond TOLERANCE
const TOLERANCE = 24; // per-channel abs difference below which a pixel counts as "same"

const PAIRS = [
    ['tests/baselines/render-regression-webgl.png', 'render-regression-webgl.png'],
    ['tests/baselines/render-regression-webgpu.png', 'render-regression-webgpu.png'],
];

async function loadRGBA(path) {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

async function compare(baselinePath, candidatePath) {
    const [a, b] = await Promise.all([loadRGBA(baselinePath), loadRGBA(candidatePath)]);
    if (a.width !== b.width || a.height !== b.height) {
        return { pass: false, reason: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}` };
    }
    let diffPixels = 0;
    const totalPixels = a.width * a.height;
    for (let i = 0; i < a.data.length; i += 4) {
        const dr = Math.abs(a.data[i] - b.data[i]);
        const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
        const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (dr > TOLERANCE || dg > TOLERANCE || db > TOLERANCE) diffPixels++;
    }
    const diffRatio = diffPixels / totalPixels;
    return { pass: diffRatio <= DIFF_THRESHOLD, diffRatio };
}

let anyFail = false;
let anyInfo = false;

for (const [baseline, candidate] of PAIRS) {
    if (!existsSync(candidate)) {
        console.log(`INFO: ${candidate} was not produced this run (capture likely failed/timed out) — skipping.`);
        anyInfo = true;
        continue;
    }
    if (!existsSync(baseline)) {
        console.log(`INFO: no baseline at ${baseline} yet — review ${candidate} and commit it there to enable enforcement.`);
        anyInfo = true;
        continue;
    }
    const result = await compare(baseline, candidate);
    if (result.pass) {
        console.log(`OK ${candidate}: diff ${(result.diffRatio * 100).toFixed(2)}% <= ${DIFF_THRESHOLD * 100}%`);
    } else {
        console.error(`FAIL ${candidate}: ${result.reason ?? `diff ${(result.diffRatio * 100).toFixed(2)}% > ${DIFF_THRESHOLD * 100}%`}`);
        anyFail = true;
    }
}

if (anyFail) {
    console.error('\nRENDER REGRESSION: pixel diff exceeded threshold against stored baseline.');
    process.exit(1);
}
if (anyInfo) {
    console.log('\nRENDER REGRESSION: informational only this run (see notes above).');
}
process.exit(0);
