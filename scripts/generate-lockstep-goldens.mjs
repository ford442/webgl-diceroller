#!/usr/bin/env node
/**
 * generate-lockstep-goldens.mjs — rewrite tests/golden/lockstep.json from Node.
 *
 *   npm run golden:lockstep
 *
 * Records each scripted lockstep log (packages/dice-core/test/lockstepScenarios.ts)
 * and the table it leaves when every input arrives on time. lockstep.test.ts
 * replays the recorded logs to these bytes, and every rollback test converges
 * on them. Regenerate after a SOLVER_REVISION bump, a serializeState() format
 * change, a re-exported tavern world or an edited scenario.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

import { defaultPublicDir, fsAssetSource, wasmArtifactsPresent } from 'dice-core';
import { loadWasmBuildInfo } from 'dice-core/wasm/SolverBuildId';
import { parseWorldFixtureFile } from 'dice-core/wasm/WorldRecorder';
import {
    LOCKSTEP_GOLDEN_PATH,
    LOCKSTEP_SCENARIOS,
    createLockstepTable,
    replayInOrder,
    snapshotVersion,
    stateDigest,
} from '../packages/dice-core/test/lockstepScenarios.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO_ROOT, LOCKSTEP_GOLDEN_PATH);

if (!wasmArtifactsPresent()) {
    console.error('[golden:lockstep] public/wasm missing — run npm run build:wasm first.');
    process.exit(1);
}

const assets = fsAssetSource(defaultPublicDir());
const { hash: worldHash, world } = parseWorldFixtureFile(
    readFileSync(path.join(REPO_ROOT, 'tests/fixtures/tavern-world.json'), 'utf8')
);
const { solver_revision: solverRevision = 0 } = await loadWasmBuildInfo('wasm', assets);
const table = await createLockstepTable(world, assets);

const scenarios = [];
let version = 0;
for (const scenario of LOCKSTEP_SCENARIOS) {
    const records = scenario.build(world);
    const { bytes, faces, sim } = replayInOrder(table, records, scenario.ticks);
    version = snapshotVersion(bytes);
    scenarios.push({
        name: scenario.name,
        ticks: scenario.ticks,
        records,
        digest: stateDigest(bytes),
        faces,
        maxSnapshotBytes: sim.stats.maxSnapshotBytes,
    });
    console.log(
        `[golden:lockstep] ${scenario.name}: ${records.length} records, ${scenario.ticks} ticks, ` +
            `faces ${faces.join(',')}, snapshot ≤ ${sim.stats.maxSnapshotBytes} B`
    );
}

const file = { version: 1, solverRevision, snapshotVersion: version, worldHash, scenarios };
const options = { ...(await prettier.resolveConfig(OUT)), parser: 'json' };
writeFileSync(OUT, await prettier.format(JSON.stringify(file), options));
console.log(`[golden:lockstep] wrote ${scenarios.length} scenarios → ${LOCKSTEP_GOLDEN_PATH}`);
