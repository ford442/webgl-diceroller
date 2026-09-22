/**
 * verify-tower-drop-replay.mjs — a dice-tower dump is a replayable roll.
 *
 * Loads the real tower chute (src/environment/diceTowerLayout.js) into a
 * headless WASM engine, drops the same dice through it twice from one seed,
 * and requires the two runs to agree bit-for-bit: same solver state, same face
 * values. Then repeats with a different seed and requires them to differ, so a
 * chute that swallowed every die could not pass by accident.
 *
 * This is the acceptance harness for `?src=tower` share links and for a guest
 * replaying a host's drop in a `?room=` — a tower drop that drew from
 * Math.random() would fail the first check.
 *
 * Usage:
 *   npm run verify:tower-drop-replay
 *   node scripts/verify-tower-drop-replay.mjs --seed 12345 --dice d20,d20,d6
 *   node scripts/verify-tower-drop-replay.mjs --require-settle
 *
 * Without public/wasm artifacts it skips locally (run `npm run build:wasm`),
 * but **fails under CI** (`$CI`), where the workflow downloads them on
 * purpose: a silent skip there is a job that tests nothing while reporting
 * green, which is exactly how the repo's WASM coverage went unnoticed.
 *
 * `--require-settle` additionally demands that the drop finish: every die
 * asleep and reading a face. It is OFF by default because the chute does not
 * currently let a die through — every ramp's low edge clears the opposing wall
 * by 0.36-0.77 units where a d20 needs ~2.0, so dice wedge on the first ramp
 * and never reach the tray. That is a prop-geometry defect, not a determinism
 * one (the wedged state is bit-identical from the same seed, which is what
 * this harness exists to prove), and it predates seeded drops. Turn the flag
 * on by default once the chute is opened up.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    createDiceTowerHopperFrame,
    worldDiceTowerColliders,
} from '../src/environment/diceTowerLayout.js';
import {
    applyDropParams,
    computeSeededHopperDropParams,
} from '../src/core-engine/wasm/seededHopperDrop.js';
import { createSeededRng } from '../src/core-engine/wasm/seededThrowParams.js';
import {
    PHYSICS_GRAVITY,
    PHYSICS_TABLE_HALF,
    PHYSICS_TABLE_Y,
    getDieSides,
    presetForShape,
} from '../src/core-engine/wasm/physicsPresets.js';
import { createInProcessPhysicsSession } from '../src/core-engine/wasm/WasmPhysicsBridge.js';
import { createNodeAssetUrl, wasmArtifactsPresent } from '../src/core-engine/rollHeadless.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

/** Where tierDefinitions.js places the tower, and how it is yawed. */
const TOWER_ORIGIN = { x: 0, y: -3.0, z: -14 };
const TOWER_YAW = 0;

const FIXED_DT = 1 / 120;
const MAX_STEPS = 120 * 25;
const IDLE_STEPS_REQUIRED = 8;
const WOOD_MATERIAL_TAG = 2;

function parseArgs(argv) {
    const args = { seed: 0x7a1e5, dice: ['d20', 'd20', 'd6'], requireSettle: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--seed') args.seed = Number.parseInt(argv[++i], 10) >>> 0;
        else if (argv[i] === '--dice') args.dice = argv[++i].split(',').map((s) => s.trim());
        else if (argv[i] === '--require-settle') args.requireSettle = true;
    }
    return args;
}

/** Where tierDefinitions.js places the tower: origin plus yaw. */
const TOWER_PLACEMENT = { origin: TOWER_ORIGIN, yaw: TOWER_YAW };

function addTowerStatics(engine) {
    const colliders = worldDiceTowerColliders(TOWER_PLACEMENT);
    for (const { userId, center, rotation, halfExtents } of colliders) {
        engine.addStaticBox(
            userId,
            center.x,
            center.y,
            center.z,
            halfExtents[0],
            halfExtents[1],
            halfExtents[2],
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.w,
            WOOD_MATERIAL_TAG
        );
    }
    return colliders.length;
}

/**
 * Read hulls.json off disk rather than letting the bridge fetch it.
 *
 * `loadHullTable` uses `fetch`, which cannot read a `file:` URL in Node — it
 * throws, the bridge swallows it, and every die silently becomes a sphere with
 * no face table, so `getFaceValues()` comes back all zeros. That would make
 * this harness's whole point ("same seed, same faces") vacuously true while
 * testing marbles instead of dice down the chute.
 */
async function loadHullsFromDisk() {
    const raw = await readFile(path.join(PUBLIC_DIR, 'wasm', 'hulls.json'), 'utf8');
    return JSON.parse(raw);
}

function stepUntilSettled(engine) {
    let idle = 0;
    for (let steps = 0; steps < MAX_STEPS; steps++) {
        engine.step(FIXED_DT);
        if (engine.areAllSettled()) {
            idle++;
            if (idle >= IDLE_STEPS_REQUIRED) return { steps, settled: true };
        } else {
            idle = 0;
        }
    }
    return { steps: MAX_STEPS, settled: false };
}

function hashBytes(bytes) {
    let h = 14695981039346656037n;
    const prime = 1099511628211n;
    const mask = (1n << 64n) - 1n;
    for (const b of bytes) {
        h ^= BigInt(b);
        h = (h * prime) & mask;
    }
    return `0x${h.toString(16)}`;
}

export async function runDrop(session, types, seed) {
    const { engine } = session;
    engine.reset();
    engine.init(PHYSICS_GRAVITY, PHYSICS_TABLE_Y, PHYSICS_TABLE_HALF, PHYSICS_TABLE_HALF);
    addTowerStatics(engine);

    const spawned = types.map((type, index) => {
        const sides = getDieSides(type);
        const preset = presetForShape(type);
        // Spawned anywhere: the drop overwrites every pose from the PRNG, which
        // is exactly why it replays.
        const wasmId = engine.addDie(sides, 0, PHYSICS_TABLE_Y + 1 + index, 0);
        engine.setDieMaterial(wasmId, preset.friction, preset.rollingFriction);
        engine.setDieDrag(wasmId, preset.dragFactor ?? 0);
        session.loadHullForDie(wasmId, sides);
        return { wasmId, index, type };
    });

    const dice = spawned.map(({ wasmId, index }) => ({ id: wasmId, index }));
    applyDropParams(
        engine,
        computeSeededHopperDropParams(
            createSeededRng(seed),
            dice,
            createDiceTowerHopperFrame(TOWER_PLACEMENT)
        )
    );

    const { steps, settled } = stepUntilSettled(engine);
    return {
        steps,
        settled,
        faceValues: Array.from(engine.getFaceValues?.() ?? []),
        stateHash: hashBytes(engine.serializeState()),
        dieCount: spawned.length,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!wasmArtifactsPresent(PUBLIC_DIR)) {
        const where = `${path.join(PUBLIC_DIR, 'wasm')} / ${path.join(PUBLIC_DIR, 'wasm-scalar')}`;
        if (process.env.CI) {
            console.error(
                `[verify-tower-drop-replay] FAIL: no dice_physics.wasm under ${where}. ` +
                    'CI downloads the wasm-artifacts bundle for this job, so a skip here would ' +
                    'be a job that tests nothing and reports green.'
            );
            process.exitCode = 1;
            return;
        }
        console.log(
            `[verify-tower-drop-replay] Skipping — no dice_physics.wasm under ${where}. ` +
                'Run `npm run build:wasm`.'
        );
        return;
    }

    const session = await createInProcessPhysicsSession({
        assetUrl: createNodeAssetUrl(PUBLIC_DIR),
        loadHulls: loadHullsFromDisk,
    });
    if (!session.available) {
        console.error('[verify-tower-drop-replay] WASM engine failed to load.');
        process.exitCode = 1;
        return;
    }

    const failures = [];
    const a = await runDrop(session, args.dice, args.seed);
    const b = await runDrop(session, args.dice, args.seed);
    // A drop that produced the same state from *any* seed would pass the
    // equality checks trivially, so prove the seed reaches the poses.
    const other = await runDrop(session, args.dice, (args.seed ^ 0x5bf03635) >>> 0);

    console.log(
        `[verify-tower-drop-replay] seed=${args.seed} dice=${args.dice.join(',')} ` +
            `steps=${a.steps} settled=${a.settled} faces=${JSON.stringify(a.faceValues)} ` +
            `state=${a.stateHash}`
    );

    if (a.stateHash !== b.stateHash) {
        failures.push(
            `same seed produced different solver state: ${a.stateHash} vs ${b.stateHash}`
        );
    }
    if (JSON.stringify(a.faceValues) !== JSON.stringify(b.faceValues)) {
        failures.push(
            `same seed produced different faces: ${JSON.stringify(a.faceValues)} vs ${JSON.stringify(b.faceValues)}`
        );
    }
    if (other.stateHash === a.stateHash) {
        failures.push(
            'a different seed produced an identical drop — the seed is not reaching the poses'
        );
    }

    // Settling is a property of the chute, not of the seed. Reported always;
    // fatal only under --require-settle (see the header).
    const unsettled = !a.settled || !b.settled;
    const facesUnread =
        a.faceValues.length !== args.dice.length || a.faceValues.some((v) => v === 0);
    if (unsettled || facesUnread) {
        const note =
            `drop did not finish within ${MAX_STEPS} steps (dt=${FIXED_DT}): ` +
            `settled=${a.settled}, faces=${JSON.stringify(a.faceValues)}. Dice wedge on a ramp — ` +
            'the chute leaves no gap wide enough for a die to pass (see the header).';
        if (args.requireSettle) failures.push(note);
        else console.warn(`[verify-tower-drop-replay] WARN: ${note}`);
    }

    if (failures.length) {
        for (const f of failures) console.error(`[verify-tower-drop-replay] FAIL: ${f}`);
        process.exitCode = 1;
        return;
    }
    console.log('[verify-tower-drop-replay] Tower drops replay identically from the same seed.');
}

// Importable for tests (see tests/unit/diceTowerLayout.test.ts, which drives
// runDrop against a mock engine); only the CLI entry point runs the checks.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
    main().catch((err) => {
        console.error(`[verify-tower-drop-replay] ${err?.stack ?? err}`);
        process.exitCode = 1;
    });
}
