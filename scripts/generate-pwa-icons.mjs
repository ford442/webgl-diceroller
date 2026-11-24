#!/usr/bin/env node
/**
 * Generate PNG PWA icons from the d20 favicon SVG (public/favicon.svg).
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'public/favicon.svg');
const outDir = resolve(root, 'public');

const svg = await readFile(svgPath, 'utf8');

const sizes = [192, 512];
for (const size of sizes) {
    const padded = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a0f08"/>
  <g transform="translate(${size * 0.1}, ${size * 0.1}) scale(${(size * 0.8) / 64})">
    ${svg
        .replace(/<\?xml[^>]*\?>/, '')
        .replace(/<svg[^>]*>/, '')
        .replace(/<\/svg>/, '')}
  </g>
</svg>`;

    await sharp(Buffer.from(padded))
        .png()
        .toFile(resolve(outDir, `pwa-${size}x${size}.png`));
    console.log(`wrote public/pwa-${size}x${size}.png`);
}
