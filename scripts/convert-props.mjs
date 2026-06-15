#!/usr/bin/env node
/**
 * Orchestrates prop asset optimization:
 *   1. Copy Basis transcoder to public/basis/ (for KTX2Loader)
 *   2. Convert shared JPG textures -> KTX2
 *   3. Convert external prop meshes -> Draco GLB
 *   4. Write scripts/prop-asset-audit.json with before/after sizes
 *
 * Usage: npm run convert:props
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { convertTexturesToKtx2 } from './convert-textures-to-ktx2.mjs';
import { convertPropsToGlb } from './convert-props-to-glb.mjs';
import {
    PROP_MESH_SOURCES,
    TEXTURE_ENTRIES,
    PROCEDURAL_PROP_MODULES,
} from './prop-asset-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASIS_OUT = path.join(ROOT, 'public', 'basis');
const AUDIT_PATH = path.join(__dirname, 'prop-asset-audit.json');

async function copyBasisTranscoder() {
    const srcDir = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
    await fs.mkdir(BASIS_OUT, { recursive: true });

    const jsSrc = path.join(srcDir, 'basis_transcoder.js');
    const jsDst = path.join(BASIS_OUT, 'basis_transcoder.js');
    await fs.copyFile(jsSrc, jsDst);

    // WASM is not shipped inside the npm three package; fetch from three.js dev branch.
    const wasmDst = path.join(BASIS_OUT, 'basis_transcoder.wasm');
    if (!existsSync(wasmDst)) {
        const wasmUrl = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/libs/basis/basis_transcoder.wasm';
        const response = await fetch(wasmUrl);
        if (!response.ok) {
            throw new Error(`Failed to download basis_transcoder.wasm (${response.status})`);
        }
        const wasm = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(wasmDst, wasm);
    }

    return {
        js: jsDst,
        wasm: wasmDst,
    };
}

async function measureJpgTotal() {
    let total = 0;
    for (const entry of TEXTURE_ENTRIES) {
        const jpgPath = path.join(ROOT, 'public', 'images', entry.src);
        if (!existsSync(jpgPath)) continue;
        const stat = await fs.stat(jpgPath);
        total += stat.size;
    }
    return total;
}

async function main() {
    console.log('=== Prop asset optimization pipeline ===\n');

    console.log('1/3  Installing Basis transcoder to public/basis/ ...');
    const basisFiles = await copyBasisTranscoder();
    console.log(`     ${path.relative(ROOT, basisFiles.js)}`);
    console.log(`     ${path.relative(ROOT, basisFiles.wasm)}\n`);

    const jpgBefore = await measureJpgTotal();
    let meshBefore = 0;
    for (const prop of PROP_MESH_SOURCES) {
        const srcPath = path.join(ROOT, prop.srcRel);
        if (existsSync(srcPath)) {
            meshBefore += (await fs.stat(srcPath)).size;
        }
    }

    console.log('2/3  Converting textures (JPG -> KTX2) ...\n');
    const textureReport = await convertTexturesToKtx2();

    console.log('\n3/3  Converting prop meshes (OBJ -> Draco GLB) ...\n');
    const meshReport = await convertPropsToGlb();

    const audit = {
        generatedAt: new Date().toISOString(),
        textures: {
            entries: textureReport.results,
            jpgBytesBefore: textureReport.totalJpg,
            ktx2BytesAfter: textureReport.totalKtx2,
            savingsPct: textureReport.totalJpg > 0
                ? Number(((1 - textureReport.totalKtx2 / textureReport.totalJpg) * 100).toFixed(1))
                : 0,
            encoder: textureReport.basisuBin,
        },
        meshes: {
            entries: meshReport.results,
            srcBytesBefore: meshReport.totalSrc,
            glbBytesAfter: meshReport.totalGlb,
            gzipBytesAfter: meshReport.totalGz,
            savingsPct: meshReport.totalSrc > 0
                ? Number(((1 - meshReport.totalGlb / meshReport.totalSrc) * 100).toFixed(1))
                : 0,
        },
        proceduralProps: PROCEDURAL_PROP_MODULES,
        externalMeshSources: PROP_MESH_SOURCES.map((p) => ({
            id: p.id,
            src: p.srcRel,
            out: p.outRel,
        })),
        notes: [
            'KTX2 textures are preferred at runtime; JPG fallbacks remain in public/images/.',
            'Procedural props use inline BufferGeometry and are not exported to GLB by this pipeline.',
            'Re-run after editing source OBJ or JPG textures.',
        ],
    };

    await fs.writeFile(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`);

    const totalBefore = jpgBefore + meshBefore;
    const totalAfter = textureReport.totalKtx2 + meshReport.totalGlb;
    const overallPct = totalBefore > 0
        ? ((1 - totalAfter / totalBefore) * 100).toFixed(1)
        : '0.0';

    console.log('\n=== Overall ===');
    console.log(`  Textures:  ${(jpgBefore / 1024).toFixed(0)} KB JPG -> ${(textureReport.totalKtx2 / 1024).toFixed(0)} KB KTX2`);
    console.log(`  Meshes:    ${(meshBefore / 1024).toFixed(0)} KB src -> ${(meshReport.totalGlb / 1024).toFixed(0)} KB GLB`);
    console.log(`  Combined:  ${(totalBefore / 1024).toFixed(0)} KB -> ${(totalAfter / 1024).toFixed(0)} KB (${overallPct}% smaller)`);
    console.log(`\nAudit written to ${path.relative(ROOT, AUDIT_PATH)}`);
    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
