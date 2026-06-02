/**
 * extract-hulls.mjs
 *
 * Build-time script that reads dice GLB files and extracts minimal convex-hull
 * vertex data for each die type.  Uses @gltf-transform/core with Draco support.
 *
 * The dice models have rounded/beveled edges, so a raw convex hull contains
 * hundreds of spurious vertices.  We compute the model's bounding radius and
 * then substitute the mathematically perfect canonical vertices for each
 * platonic / archimedean solid, scaled to match the model size.
 *
 * Usage:
 *   node scripts/extract-hulls.mjs
 *
 * Output:
 *   public/wasm/hulls.json
 */

import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'fs';

const DICE = [
  { type: 'd4',  file: 'public/images/dice/die_4.glb',  sides: 4  },
  { type: 'd6',  file: 'public/images/dice/die_6.glb',  sides: 6  },
  { type: 'd8',  file: 'public/images/dice/die_8.glb',  sides: 8  },
  { type: 'd10', file: 'public/images/dice/die_10.glb', sides: 10 },
  { type: 'd12', file: 'public/images/dice/die_12.glb', sides: 12 },
  { type: 'd20', file: 'public/images/dice/die_20.glb', sides: 20 },
];

// Canonical vertices for regular polyhedra (unit circumradius)
const CANONICAL = {
  d4: [
    [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]
  ],
  d6: [
    [-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
    [-1,-1, 1], [1,-1, 1], [1,1, 1], [-1,1, 1]
  ],
  d8: [
    [1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]
  ],
  d10: (() => {
    // Pentagonal trapezohedron (decahedron / d10)
    // Two pentagonal caps rotated 36° relative to each other.
    const verts = [];
    const phi = (1 + Math.sqrt(5)) / 2;
    // Approximate unit-radius trapezohedron.
    // Top and bottom apices (the "points" of the kites)
    verts.push([0, 1, 0]);
    verts.push([0, -1, 0]);
    // Upper pentagon at y ≈ 0.35, radius ≈ 0.85
    // Lower pentagon at y ≈ -0.35, radius ≈ 0.85, rotated 36°
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5;
      verts.push([Math.cos(a) * 0.85, 0.35, Math.sin(a) * 0.85]);
    }
    for (let i = 0; i < 5; i++) {
      const a = ((i + 0.5) * 2 * Math.PI) / 5;
      verts.push([Math.cos(a) * 0.85, -0.35, Math.sin(a) * 0.85]);
    }
    return verts;
  })(),
  d12: (() => {
    const phi = (1 + Math.sqrt(5)) / 2;
    const invPhi = 1 / phi;
    return [
      [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
      [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
      [0, invPhi, phi], [0, invPhi, -phi], [0, -invPhi, phi], [0, -invPhi, -phi],
      [invPhi, phi, 0], [invPhi, -phi, 0], [-invPhi, phi, 0], [-invPhi, -phi, 0],
      [phi, 0, invPhi], [phi, 0, -invPhi], [-phi, 0, invPhi], [-phi, 0, -invPhi]
    ];
  })(),
  d20: (() => {
    const phi = (1 + Math.sqrt(5)) / 2;
    return [
      [0, 1, phi], [0, 1, -phi], [0, -1, phi], [0, -1, -phi],
      [1, phi, 0], [1, -phi, 0], [-1, phi, 0], [-1, -phi, 0],
      [phi, 0, 1], [phi, 0, -1], [-phi, 0, 1], [-phi, 0, -1]
    ];
  })(),
};

const decoderModule = await draco3d.createDecoderModule();

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({ 'draco3d.decoder': decoderModule });

const result = {};

for (const die of DICE) {
  const doc = await io.read(die.file);
  const root = doc.getRoot();

  let positions = null;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const attr = prim.getAttribute('POSITION');
      if (attr) {
        positions = attr.getArray();
        break;
      }
    }
    if (positions) break;
  }

  if (!positions) {
    console.warn(`[extract-hulls] No POSITION accessor in ${die.file}`);
    continue;
  }

  // The glTF positions may be normalized SHORT integers.  getArray() returns
  // raw component values, so we detect the component type and scale.
  let normalizeScale = 1.0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const attr = prim.getAttribute('POSITION');
      if (attr) {
        const ct = attr.getComponentType();
        // 5120=BYTE, 5121=UNSIGNED_BYTE, 5122=SHORT, 5123=UNSIGNED_SHORT
        if (ct === 5120 || ct === 5121) normalizeScale = 127.0;
        if (ct === 5122 || ct === 5123) normalizeScale = 32767.0;
        break;
      }
    }
    break;
  }

  // Compute centroid and average vertex radius
  let cx = 0, cy = 0, cz = 0;
  const count = positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i] / normalizeScale;
    cy += positions[i+1] / normalizeScale;
    cz += positions[i+2] / normalizeScale;
  }
  cx /= count; cy /= count; cz /= count;

  let maxR = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] / normalizeScale - cx;
    const dy = positions[i+1] / normalizeScale - cy;
    const dz = positions[i+2] / normalizeScale - cz;
    const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (r > maxR) maxR = r;
  }

  // Compute canonical circumradius
  const canon = CANONICAL[die.type];
  let canonR = 0;
  for (const v of canon) {
    const r = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    if (r > canonR) canonR = r;
  }

  const scale = maxR / canonR;
  const verts = canon.map(v => [v[0] * scale + cx, v[1] * scale + cy, v[2] * scale + cz]);

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
  console.log(`[extract-hulls] ${die.type}: ${verts.length} canonical verts, scale=${scale.toFixed(4)}, maxR=${maxR.toFixed(4)}`);
}

fs.writeFileSync('public/wasm/hulls.json', JSON.stringify(result, null, 2));
console.log('[extract-hulls] Wrote public/wasm/hulls.json');
