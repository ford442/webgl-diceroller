#!/usr/bin/env node
/**
 * convert-dice-to-glb.js
 * -----------------------------------------------------------------------------
 * Converts the legacy Collada (.dae) dice models in public/images/ into
 * Draco-compressed binary glTF (.glb) assets in public/images/dice/.
 *
 * Why a headless browser?  three.js' ColladaLoader and GLTFExporter are written
 * for the browser (DOMParser, FileReader, etc.).  Rather than polyfill a DOM in
 * Node, we drive a headless Chromium (already installed for Playwright) and run
 * the loaders in their native environment.  The browser hands back an
 * uncompressed .glb buffer, then Node post-processes it with @gltf-transform to
 * weld, quantize and Draco-compress the geometry (KHR_draco_mesh_compression).
 *
 * Geometry note: we BAKE each mesh's world matrix into its geometry and export a
 * single mesh with an identity transform.  At runtime dice.js does
 * `clone -> center -> applyMatrix4(matrixWorld) -> rotateX(-PI/2) -> center`.
 * Because the final `center()` cancels any translation, baking the world matrix
 * (and thus making matrixWorld the identity at load time) yields geometry that
 * is mathematically identical to the old ColladaLoader path — so physics convex
 * hulls and `readDiceValue` face-normal clustering are preserved exactly.
 *
 * Usage:  npm run convert:dice
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { weld, quantize, dedup, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'images', 'dice');

const DICE = [
    { type: 'd4', src: 'die_4.dae', out: 'die_4.glb' },
    { type: 'd6', src: 'die_6.dae', out: 'die_6.glb' },
    { type: 'd8', src: 'die_8.dae', out: 'die_8.glb' },
    { type: 'd10', src: 'die_10.dae', out: 'die_10.glb' },
    { type: 'd12', src: 'die_12.dae', out: 'die_12.glb' },
    { type: 'd20', src: 'die_20.dae', out: 'die_20.glb' },
];

// ---------------------------------------------------------------------------
// Tiny static file server so the headless page can fetch /node_modules/three/*
// and /public/images/*.dae via bare module-map imports.
// ---------------------------------------------------------------------------
const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.dae': 'model/vnd.collada+xml',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
};

function startServer() {
    const server = http.createServer(async (req, res) => {
        try {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            if (urlPath === '/__convert.html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(PAGE_HTML);
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

// HTML page (served at /__convert.html) with an import map mapping the bare
// "three" specifier (used by the example loaders/exporters) to the locally
// served module build. A module script statically imports three — static
// imports reliably honour the import map — and exposes window.convertDie().
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
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Loads one .dae, bakes world matrix into geometry, exports a single-mesh
// identity-transform .glb, returns it base64-encoded.
window.convertDie = async (daeUrl) => {
    const collada = await new Promise((resolve, reject) => {
        new ColladaLoader().load(daeUrl, resolve, undefined, reject);
    });

    // Match the legacy dice.js traversal exactly: keep the LAST mesh found.
    // (e.g. die_8.dae contains a "Plane-mesh" before the real "Die-mesh".)
    let srcMesh = null;
    collada.scene.updateMatrixWorld(true);
    collada.scene.traverse((c) => { if (c.isMesh) srcMesh = c; });
    if (!srcMesh) throw new Error('no mesh in ' + daeUrl);

    // Bake the accumulated world transform into a fresh geometry.
    const geometry = srcMesh.geometry.clone();
    geometry.applyMatrix4(srcMesh.matrixWorld);
    geometry.deleteAttribute('uv2');

    // Tag body vs pip/engraving triangles so runtime can tint them independently.
    // Small-area triangles are pip geometry; the rest is die body.
    geometry.computeBoundingSphere();
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    const maxEdge = (geometry.boundingSphere?.radius ?? 1) * 0.6;
    const maxEdgeSq = maxEdge * maxEdge;
    const areas = new Float32Array(triCount);
    const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
    const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();
    const getVertex = (i) => {
        const vi = index ? index.getX(i) : i;
        return { x: pos.getX(vi), y: pos.getY(vi), z: pos.getZ(vi) };
    };
    for (let t = 0; t < triCount; t++) {
        const va = getVertex(t * 3), vb = getVertex(t * 3 + 1), vc = getVertex(t * 3 + 2);
        _a.set(va.x, va.y, va.z); _b.set(vb.x, vb.y, vb.z); _c.set(vc.x, vc.y, vc.z);
        _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _n.crossVectors(_e1, _e2);
        if (_n.lengthSq() < 1e-10) continue;
        if (_e1.lengthSq() > maxEdgeSq || _e2.lengthSq() > maxEdgeSq || _b.distanceToSquared(_c) > maxEdgeSq) continue;
        areas[t] = _n.length() * 0.5;
    }
    const sorted = Array.from(areas).filter((a) => a > 0).sort((x, y) => x - y);
    const percentile = sorted[Math.max(0, Math.floor(sorted.length * 0.22) - 1)] ?? 0;
    const areaThreshold = Math.max(percentile, sorted[0] ?? 0) * 1.15;
    const bodyTris = [], pipTris = [];
    for (let t = 0; t < triCount; t++) {
        const tri = index
            ? [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)]
            : [t * 3, t * 3 + 1, t * 3 + 2];
        if (areas[t] > 0 && areas[t] <= areaThreshold) pipTris.push(...tri);
        else bodyTris.push(...tri);
    }
    if (bodyTris.length && pipTris.length) {
        const merged = new Uint32Array(bodyTris.length + pipTris.length);
        merged.set(bodyTris, 0);
        merged.set(pipTris, bodyTris.length);
        geometry.setIndex(new THREE.BufferAttribute(merged, 1));
        geometry.clearGroups();
        geometry.addGroup(0, bodyTris.length, 0);
        geometry.addGroup(bodyTris.length, pipTris.length, 1);
    }

    const srcMat = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
    const bodyColor = srcMat?.color ? srcMat.color.clone() : new THREE.Color(0xeeeeee);
    const pipColor = bodyColor.clone().offsetHSL(0, 0, -0.35);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4, metalness: 0.0, name: 'DieBody' });
    const pipMaterial = new THREE.MeshStandardMaterial({ color: pipColor, roughness: 0.45, metalness: 0.0, name: 'DiePips' });
    const materials = geometry.groups?.length >= 2 ? [bodyMaterial, pipMaterial] : bodyMaterial;

    const mesh = new THREE.Mesh(geometry, materials);
    const scene = new THREE.Scene();
    scene.add(mesh);

    const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(
            scene,
            (result) => resolve(result),
            (err) => reject(err),
            { binary: true, onlyVisible: false }
        );
    });

    // ArrayBuffer -> base64 (chunked to avoid call-stack limits).
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

    // Geometry cleanup before encoding: dedup shared resources, weld vertices
    // into an indexed mesh (Draco requires indices), prune orphans, then
    // quantize positions/normals to shrink the encoded payload.
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

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });

    const io = new NodeIO()
        .registerExtensions([KHRDracoMeshCompression])
        .registerDependencies({
            'draco3d.encoder': await draco3d.createEncoderModule(),
            'draco3d.decoder': await draco3d.createDecoderModule(),
        });

    const server = await startServer();
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [page]', m.text()); });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));
    await page.goto(base + '/__convert.html', { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true');

    let totalRaw = 0;
    let totalGz = 0;
    const results = [];

    for (const die of DICE) {
        const daeUrl = `${base}/raw_models/dae/${die.src}`;
        process.stdout.write(`Converting ${die.src} ... `);

        const b64 = await page.evaluate((url) => window.convertDie(url), daeUrl);
        const rawGlb = Buffer.from(b64, 'base64');
        const dracoGlb = await dracoCompress(io, rawGlb);

        const outPath = path.join(OUT_DIR, die.out);
        await fs.writeFile(outPath, dracoGlb);

        const gz = zlib.gzipSync(dracoGlb).length;
        totalRaw += dracoGlb.length;
        totalGz += gz;
        results.push({ out: die.out, glb: dracoGlb.length, gz });
        console.log(`${(dracoGlb.length / 1024).toFixed(1)} KB (gzip ${(gz / 1024).toFixed(1)} KB)`);
    }

    await browser.close();
    server.close();

    console.log('\n--- Summary ---');
    for (const r of results) {
        console.log(`  ${r.out.padEnd(12)} ${(r.glb / 1024).toFixed(1).padStart(8)} KB   gzip ${(r.gz / 1024).toFixed(1).padStart(7)} KB`);
    }
    console.log(`  ${'TOTAL'.padEnd(12)} ${(totalRaw / 1024).toFixed(1).padStart(8)} KB   gzip ${(totalGz / 1024).toFixed(1).padStart(7)} KB`);
    console.log(`\nDone. Output in ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
