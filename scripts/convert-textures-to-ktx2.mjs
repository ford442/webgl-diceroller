#!/usr/bin/env node
/**
 * Batch-converts shared JPG PBR textures to KTX2 (Basis ETC1S) using basisu.
 * Original JPGs are kept for runtime fallback via TexturePipeline.
 *
 * Usage: node scripts/convert-textures-to-ktx2.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { TEXTURE_ENTRIES } from './prop-asset-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public', 'images');

function resolveBasisu() {
    const candidates = [
        process.env.BASISU,
        path.join(ROOT, 'node_modules', 'basisu', 'bin', 'linux', 'x64_sse', 'basisu'),
        path.join(ROOT, 'node_modules', 'basisu', 'bin', 'linux', 'x64', 'basisu'),
        'basisu',
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate === 'basisu') {
            const probe = spawnSync('which', ['basisu'], { encoding: 'utf8' });
            if (probe.status === 0) return probe.stdout.trim();
            continue;
        }
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

function encodeKtx2(basisuBin, srcPath, outPath, { linear = false } = {}) {
    const args = [
        '-ktx2',
        '-q', '128',
        '-file', srcPath,
        '-output_file', outPath,
    ];
    if (linear) args.push('-linear');

    const result = spawnSync(basisuBin, args, { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(
            `basisu failed for ${path.basename(srcPath)}:\n${result.stderr || result.stdout}`
        );
    }
}

async function fileSize(filePath) {
    try {
        const stat = await fs.stat(filePath);
        return stat.size;
    } catch {
        return 0;
    }
}

export async function convertTexturesToKtx2({ quiet = false } = {}) {
    const basisuBin = resolveBasisu();
    if (!basisuBin) {
        throw new Error(
            'basisu encoder not found. Install devDependency "basisu" or set BASISU env var.'
        );
    }

    const results = [];
    let totalJpg = 0;
    let totalKtx2 = 0;

    for (const entry of TEXTURE_ENTRIES) {
        const jpgPath = path.join(IMAGES_DIR, entry.src);
        const ktx2Path = jpgPath.replace(/\.jpe?g$/i, '.ktx2');

        if (!existsSync(jpgPath)) {
            if (!quiet) console.warn(`  skip (missing): ${entry.src}`);
            continue;
        }

        const jpgBytes = await fileSize(jpgPath);
        encodeKtx2(basisuBin, jpgPath, ktx2Path, { linear: entry.linear });
        const ktx2Bytes = await fileSize(ktx2Path);

        totalJpg += jpgBytes;
        totalKtx2 += ktx2Bytes;
        const ratio = jpgBytes > 0 ? ((1 - ktx2Bytes / jpgBytes) * 100).toFixed(1) : '0.0';
        results.push({
            set: entry.set,
            role: entry.role,
            src: entry.src,
            jpgBytes,
            ktx2Bytes,
            savingsPct: Number(ratio),
        });

        if (!quiet) {
            process.stdout.write(
                `  ${entry.src.padEnd(58)} `
                + `${(jpgBytes / 1024).toFixed(0).padStart(5)} KB -> `
                + `${(ktx2Bytes / 1024).toFixed(0).padStart(5)} KB `
                + `(${ratio}% smaller)\n`
            );
        }
    }

    if (!quiet) {
        const overall = totalJpg > 0 ? ((1 - totalKtx2 / totalJpg) * 100).toFixed(1) : '0.0';
        console.log(
            `\n  TEXTURE TOTAL  ${(totalJpg / 1024).toFixed(0)} KB JPG -> `
            + `${(totalKtx2 / 1024).toFixed(0)} KB KTX2 (${overall}% smaller)`
        );
    }

    return { results, totalJpg, totalKtx2, basisuBin };
}

async function main() {
    console.log('Converting shared textures to KTX2 (Basis ETC1S)...\n');
    await convertTexturesToKtx2();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
