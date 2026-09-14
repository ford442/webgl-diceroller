#!/usr/bin/env node
/**
 * Re-encode the legacy JPG textures in public/images/ that only exist as a
 * KTX2-load-failure fallback (see TexturePipeline.js). These originals were
 * saved at near-lossless quality even though KTX2 is the path every modern
 * target actually takes (the Basis transcoder is precached — see
 * CRITICAL_PRELOADS in vite.config.js), so the JPGs were paying full-quality
 * bytes for a path that almost never runs. Re-encoding at quality 80 with
 * mozjpeg keeps them a legible fallback at a fraction of the size.
 *
 * Usage: node scripts/reencode-fallback-jpgs.mjs
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTURE_ENTRIES } from './prop-asset-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public/images');
const QUALITY = 80;

async function main() {
    let beforeTotal = 0;
    let afterTotal = 0;

    for (const entry of TEXTURE_ENTRIES) {
        const relPath = entry.src;
        const filePath = path.join(IMAGES_DIR, relPath);
        const before = (await fs.stat(filePath)).size;
        const buf = await sharp(filePath).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
        await fs.writeFile(filePath, buf);
        const after = buf.length;
        beforeTotal += before;
        afterTotal += after;
        console.log(
            `${relPath.padEnd(55)} ${(before / 1024).toFixed(0).padStart(6)} KB -> ${(after / 1024).toFixed(0).padStart(6)} KB`
        );
    }

    console.log(
        `\nTotal: ${(beforeTotal / 1024 / 1024).toFixed(2)} MB -> ${(afterTotal / 1024 / 1024).toFixed(2)} MB`
    );
}

main();
