#!/usr/bin/env node
/**
 * Converts external prop mesh sources (currently the billiard lamp OBJ) to
 * Draco-compressed GLB, mirroring scripts/convert-dice-to-glb.mjs.
 *
 * Usage: node scripts/convert-props-to-glb.mjs
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { weld, quantize, dedup, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { PROP_MESH_SOURCES } from './prop-asset-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.obj': 'text/plain',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.glb': 'model/gltf-binary',
};

function startServer(pageHtml) {
    const server = http.createServer(async (req, res) => {
        try {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/__convert.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(pageHtml);
                return;
            }
            const filePath = path.join(ROOT, urlPath);
            if (!filePath.startsWith(ROOT)) {
                res.writeHead(403).end();
                return;
            }
            const data = await fs.readFile(filePath);
            res.writeHead(200, {
                'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(data);
        } catch {
            res.writeHead(404).end('not found');
        }
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">
{
  "imports": {
    "three": "/node_modules/three/build/three.module.js",
    "three/addons/": "/node_modules/three/examples/jsm/"
  }
}
</script>
</head><body>
<script type="module">
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Loads one OBJ, bakes each mesh world matrix into geometry, preserves mesh
// names for runtime material assignment (Lamp.js), exports identity-root GLB.
window.convertObj = async (objUrl) => {
    const root = await new OBJLoader().loadAsync(objUrl);
    root.updateMatrixWorld(true);

    const exportRoot = new THREE.Group();
    exportRoot.name = 'PropRoot';

    root.traverse((child) => {
        if (!child.isMesh) return;
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(child.matrixWorld);
        geometry.deleteAttribute('uv2');

        const material = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.5,
            metalness: 0.0,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = child.name || 'mesh';
        exportRoot.add(mesh);
    });

    if (exportRoot.children.length === 0) {
        throw new Error('no meshes in ' + objUrl);
    }

    const scene = new THREE.Scene();
    scene.add(exportRoot);

    const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(
            scene,
            (result) => resolve(result),
            (err) => reject(err),
            { binary: true, onlyVisible: false }
        );
    });

    const bytes = new Uint8Array(glb);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
};
window.__ready = true;
</script>
</body></html>`;

async function dracoCompress(io, inputBuffer) {
    const doc = await io.readBinary(inputBuffer);
    await doc.transform(
        dedup(),
        weld(),
        prune(),
        quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
    );

    doc.createExtension(KHRDracoMeshCompression)
        .setRequired(true)
        .setEncoderOptions({
            method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
            encodeSpeed: 5,
            decodeSpeed: 5,
        });

    return io.writeBinary(doc);
}

export async function convertPropsToGlb({ quiet = false } = {}) {
    const io = new NodeIO()
        .registerExtensions([KHRDracoMeshCompression])
        .registerDependencies({
            'draco3d.encoder': await draco3d.createEncoderModule(),
            'draco3d.decoder': await draco3d.createDecoderModule(),
        });

    const server = await startServer(PAGE_HTML);
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !quiet) console.error('  [page]', m.text()); });
    page.on('pageerror', (e) => { if (!quiet) console.error('  [page error]', e.message); });
    await page.goto(`${base}/__convert.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true');

    const results = [];
    let totalSrc = 0;
    let totalGlb = 0;
    let totalGz = 0;

    for (const prop of PROP_MESH_SOURCES) {
        const srcPath = path.join(ROOT, prop.srcRel);
        const outPath = path.join(ROOT, prop.outRel);
        if (!existsSync(srcPath)) {
            if (!quiet) console.warn(`  skip (missing): ${prop.srcRel}`);
            continue;
        }

        await fs.mkdir(path.dirname(outPath), { recursive: true });

        const srcStat = await fs.stat(srcPath);
        const objUrl = `${base}/${prop.srcRel.replace(/^public\//, 'public/')}`;
        if (!quiet) process.stdout.write(`Converting ${prop.label} ... `);

        const b64 = await page.evaluate((url) => window.convertObj(url), objUrl);
        const rawGlb = Buffer.from(b64, 'base64');
        const dracoGlb = await dracoCompress(io, rawGlb);
        await fs.writeFile(outPath, dracoGlb);

        const gz = zlib.gzipSync(dracoGlb).length;
        totalSrc += srcStat.size;
        totalGlb += dracoGlb.length;
        totalGz += gz;
        results.push({
            id: prop.id,
            srcBytes: srcStat.size,
            glbBytes: dracoGlb.length,
            gzBytes: gz,
            outRel: prop.outRel,
        });

        if (!quiet) {
            console.log(
                `${(srcStat.size / 1024).toFixed(0)} KB OBJ -> `
                + `${(dracoGlb.length / 1024).toFixed(0)} KB GLB `
                + `(gzip ${(gz / 1024).toFixed(0)} KB)`
            );
        }
    }

    await browser.close();
    server.close();

    return { results, totalSrc, totalGlb, totalGz };
}

async function main() {
    console.log('Converting prop meshes to Draco GLB...\n');
    const { results, totalSrc, totalGlb, totalGz } = await convertPropsToGlb();
    if (results.length === 0) {
        console.log('No prop meshes converted.');
        return;
    }
    console.log('\n--- Mesh summary ---');
    for (const r of results) {
        console.log(
            `  ${r.id.padEnd(16)} ${(r.srcBytes / 1024).toFixed(0).padStart(6)} KB -> `
            + `${(r.glbBytes / 1024).toFixed(0).padStart(6)} KB GLB`
        );
    }
    const meshRatio = totalSrc > 0 ? ((1 - totalGlb / totalSrc) * 100).toFixed(1) : '0.0';
    console.log(
        `  ${'TOTAL'.padEnd(16)} ${(totalSrc / 1024).toFixed(0).padStart(6)} KB -> `
        + `${(totalGlb / 1024).toFixed(0).padStart(6)} KB GLB (${meshRatio}% smaller)`
        + `, gzip ${(totalGz / 1024).toFixed(0)} KB`
    );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
