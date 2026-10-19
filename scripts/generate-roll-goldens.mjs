#!/usr/bin/env node
/**
 * generate-roll-goldens.mjs — rewrite tests/golden/rolls.json from Node.
 *
 *   npm run golden:rolls
 *
 * The browser twin is `npm run verify:headless-parity -- --update`. Either
 * direction writes the same file; the other side then has to agree with it.
 * Regenerate after a SOLVER_REVISION bump or a re-exported tavern world.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultPublicDir, fsAssetSource, wasmArtifactsPresent } from 'dice-core';
import { loadWasmBuildInfo } from 'dice-core/wasm/SolverBuildId';
import { GOLDEN_CASES, GOLDEN_DT, runGoldenCase } from '../packages/dice-core/test/rollGoldens.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO_ROOT, 'tests/golden/rolls.json');

if (!wasmArtifactsPresent()) {
    console.error('[golden:rolls] public/wasm missing — run npm run build:wasm first.');
    process.exit(1);
}

const assets = fsAssetSource(defaultPublicDir());
const tavernWorld = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'tests/fixtures/tavern-world.json'), 'utf8')
);
const { solver_revision: solverRevision = 0 } = await loadWasmBuildInfo('wasm', assets);

const vectors = [];
for (const c of GOLDEN_CASES) vectors.push(await runGoldenCase(c, { assets, tavernWorld }));

mkdirSync(path.dirname(OUT), { recursive: true });
const file = { version: 1, solverRevision, dt: GOLDEN_DT, generatedBy: 'node', vectors };
const options = { ...(await prettier.resolveConfig(OUT)), parser: 'json' };
writeFileSync(OUT, await prettier.format(JSON.stringify(file), options));
console.log(
    `[golden:rolls] wrote ${vectors.length} vectors (solver revision ${solverRevision}) → ${path.relative(REPO_ROOT, OUT)}`
);
