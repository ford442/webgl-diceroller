/**
 * extract-hulls-server.mjs
 *
 * Starts a minimal static server, uses Playwright to load the dice GLBs
 * through Three.js GLTFLoader + DRACOLoader (exactly as the app does),
 * extracts convex-hull vertex positions with the 'convex-hull' npm package,
 * and writes public/wasm/hulls.json.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const PORT = 9876;
const DICE = [
  { type: 'd4',  file: 'images/dice/die_4.glb',  sides: 4  },
  { type: 'd6',  file: 'images/dice/die_6.glb',  sides: 6  },
  { type: 'd8',  file: 'images/dice/die_8.glb',  sides: 8  },
  { type: 'd10', file: 'images/dice/die_10.glb', sides: 10 },
  { type: 'd12', file: 'images/dice/die_12.glb', sides: 12 },
  { type: 'd20', file: 'images/dice/die_20.glb', sides: 20 },
];

const HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <pre id="out">working...</pre>
  <script type="module">
    import * as THREE from 'https://unpkg.com/three@0.181.2/build/three.module.js';
    import { GLTFLoader } from 'https://unpkg.com/three@0.181.2/examples/jsm/loaders/GLTFLoader.js';
    import { DRACOLoader } from 'https://unpkg.com/three@0.181.2/examples/jsm/loaders/DRACOLoader.js';

    const DICE = ${JSON.stringify(DICE)};
    const result = {};

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);

    async function run() {
      for (const die of DICE) {
        const url = './' + die.file;
        const gltf = await new Promise((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });

        let mesh = null;
        gltf.scene.traverse((c) => { if (c.isMesh) mesh = c; });
        if (!mesh) continue;

        const geo = mesh.geometry.clone();
        geo.center();
        mesh.updateMatrixWorld(true);
        geo.applyMatrix4(mesh.matrixWorld);
        geo.rotateX(-Math.PI / 2);
        geo.center();

        const pos = geo.attributes.position;
        const arr = pos.array;
        const pts = [];
        for (let i = 0; i < pos.count; i++) {
          pts.push([arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]]);
        }

        result[die.type] = { sides: die.sides, points: pts };
      }
      document.getElementById('out').textContent = JSON.stringify(result);
    }
    run().catch(e => { document.getElementById('out').textContent = 'ERROR: ' + e; });
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/extract.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return;
  }
  const filePath = path.join(process.cwd(), 'public', url);
  const safePath = path.resolve(filePath);
  const publicRoot = path.resolve(process.cwd(), 'public');
  if (!safePath.startsWith(publicRoot)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!fs.existsSync(safePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(safePath);
  const mime = {
    '.glb': 'model/gltf-binary', '.js': 'text/javascript',
    '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html',
  }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(safePath).pipe(res);
});

server.listen(PORT);
console.log(`[extract-hulls] Static server on http://localhost:${PORT}`);

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/extract.html`);

  const pre = await page.waitForSelector('#out');
  await page.waitForFunction(() => {
    const t = document.getElementById('out').textContent;
    return !t.startsWith('working');
  }, { timeout: 120000 });

  const text = await pre.textContent();
  if (text.startsWith('ERROR')) throw new Error(text);

  const raw = JSON.parse(text);
  await browser.close();
  server.close();

  // Compute convex hulls in Node.js using the 'convex-hull' package
  const convexHull = (await import('convex-hull')).default;
  const result = {};

  for (const die of DICE) {
    const data = raw[die.type];
    if (!data) continue;

    const pts = data.points;
    const hullIndices = convexHull(pts); // returns list of [i,j,k] triangles

    // Collect unique vertex indices used by the hull
    const used = new Set();
    for (const tri of hullIndices) {
      used.add(tri[0]); used.add(tri[1]); used.add(tri[2]);
    }

    const verts = Array.from(used).map(i => pts[i]);

    // Compute AABB
    const min = [verts[0][0], verts[0][1], verts[0][2]];
    const max = [verts[0][0], verts[0][1], verts[0][2]];
    for (let i = 1; i < verts.length; i++) {
      const v = verts[i];
      for (let j = 0; j < 3; j++) {
        if (v[j] < min[j]) min[j] = v[j];
        if (v[j] > max[j]) max[j] = v[j];
      }
    }

    result[die.type] = { sides: die.sides, vertices: verts, aabb: { min, max } };
  }

  fs.writeFileSync('public/wasm/hulls.json', JSON.stringify(result, null, 2));
  console.log('[extract-hulls] Wrote public/wasm/hulls.json');
  for (const [k, v] of Object.entries(result)) {
    console.log(`  ${k}: ${v.vertices.length} hull verts`);
  }
}

run().catch((err) => { console.error(err); server.close(); process.exit(1); });
