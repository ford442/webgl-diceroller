#!/usr/bin/env node
// Pixel-diffs freshly captured render-regression screenshots against checked-in
// baselines under tests/baselines/. Uses sharp (already a devDependency).
//
// Usage: node scripts/render-regression.mjs && node scripts/compare-render-baseline.mjs
//
// Required profiles (webgl-nopost, webgl) fail the job when:
//   - the baseline PNG is missing
//   - the candidate screenshot is missing
//   - size mismatches or the diff ratio exceeds DIFF_THRESHOLD
//
// Optional profiles (webgpu) remain informational until a baseline is checked in
// and CI runners can capture WebGPU reliably.
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const DIFF_THRESHOLD = 0.04; // fraction of pixels allowed to differ beyond TOLERANCE
const TOLERANCE = 32; // per-channel abs difference below which a pixel counts as "same"

/** @type {{ baseline: string, candidate: string, required: boolean }[]} */
const PAIRS = [
    {
        baseline: 'tests/baselines/render-regression-webgl-nopost.png',
        candidate: 'render-regression-webgl-nopost.png',
        required: true,
    },
    {
        baseline: 'tests/baselines/render-regression-webgl.png',
        candidate: 'render-regression-webgl.png',
        required: true,
    },
    {
        baseline: 'tests/baselines/render-regression-webgpu.png',
        candidate: 'render-regression-webgpu.png',
        required: false,
    },
];

async function loadRGBA(filePath) {
    const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

async function compare(baselinePath, candidatePath) {
    const [a, b] = await Promise.all([loadRGBA(baselinePath), loadRGBA(candidatePath)]);
    if (a.width !== b.width || a.height !== b.height) {
        return {
            pass: false,
            reason: `size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`,
        };
    }
    let diffPixels = 0;
    const totalPixels = a.width * a.height;
    for (let i = 0; i < a.data.length; i += 4) {
        const dr = Math.abs(a.data[i] - b.data[i]);
        const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
        const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (dr > TOLERANCE || dg > TOLERANCE || db > TOLERANCE) diffPixels += 1;
    }
    const diffRatio = diffPixels / totalPixels;
    return { pass: diffRatio <= DIFF_THRESHOLD, diffRatio };
}

let anyFail = false;

for (const { baseline, candidate, required } of PAIRS) {
    if (!existsSync(candidate)) {
        const msg = `${candidate} was not produced this run`;
        if (required) {
            console.error(`FAIL: ${msg} (required profile).`);
            anyFail = true;
        } else {
            console.log(`INFO: ${msg} — optional profile skipped.`);
        }
        continue;
    }
    if (!existsSync(baseline)) {
        const msg = `no baseline at ${baseline}`;
        if (required) {
            console.error(
                `FAIL: ${msg}. Capture with UPDATE_BASELINES=1 and commit the PNG.`
            );
            anyFail = true;
        } else {
            console.log(
                `INFO: ${msg} — optional; review ${candidate} and commit to enable enforcement.`
            );
        }
        continue;
    }

    const result = await compare(baseline, candidate);
    if (result.pass) {
        console.log(
            `OK ${candidate}: diff ${(result.diffRatio * 100).toFixed(2)}% <= ${DIFF_THRESHOLD * 100}%`
        );
    } else {
        const detail = result.reason
            ?? `diff ${(result.diffRatio * 100).toFixed(2)}% > ${DIFF_THRESHOLD * 100}%`;
        if (required) {
            console.error(`FAIL ${candidate}: ${detail}`);
            anyFail = true;
        } else {
            console.log(`INFO ${candidate}: ${detail} (optional / soft-fail)`);
        }
    }
}

if (anyFail) {
    console.error('\nRENDER REGRESSION: required baseline check(s) failed.');
    process.exit(1);
}

console.log('\nRENDER REGRESSION: required baselines within threshold.');
process.exit(0);
