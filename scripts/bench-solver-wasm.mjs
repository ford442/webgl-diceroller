/**
 * bench-solver-wasm.mjs — WASM release step-time benchmarks (Node + SIMD when built).
 *
 * Usage:
 *   node scripts/bench-solver-wasm.mjs
 *   node scripts/bench-solver-wasm.mjs --dice=200 --steps=600 --warmup=60
 *
 * Requires public/wasm/dice_physics.{js,wasm} from npm run build:wasm.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WASM_DIR = path.join(REPO_ROOT, 'public/wasm');

const args = process.argv.slice(2);
let dieCount = 50;
let steps = 600;
let warmup = 60;
for (const arg of args) {
    if (arg.startsWith('--dice=')) dieCount = Number.parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--steps=')) steps = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--warmup=')) warmup = Number.parseInt(arg.slice(9), 10);
}

const CUBE_VERTS = [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
    0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
];

async function loadFactory() {
    const jsPath = path.join(WASM_DIR, 'dice_physics.js');
    const wasmPath = path.join(WASM_DIR, 'dice_physics.wasm');
    await readFile(jsPath);
    const wasmBinary = new Uint8Array(await readFile(wasmPath));
    const createModule = (await import(pathToFileURL(jsPath).href)).default;
    return createModule({ wasmBinary });
}

function runBench(factory, count, stepCount, warmSteps) {
    const engine = new factory.DicePhysicsEngine();
    engine.init(-15.0, -2.75, 18.0, 18.0);

    const hullVec = new factory.VectorFloat();
    for (const n of CUBE_VERTS) hullVec.push_back(n);

    for (let i = 0; i < count; ++i) {
        const x = ((i % 10) - 5) * 0.4;
        const y = 3.0 + i * 0.05;
        const z = ((Math.floor(i / 10) % 10) - 5) * 0.4;
        const id = engine.addDie(6, x, y, z);
        if (id >= 0) engine.setDieHull(id, hullVec);
        engine.applyImpulse(id, 5.0, 2.0, -3.0);
        engine.applyTorqueImpulse(id, 10.0, 0.0, 5.0);
    }

    const dt = 1 / 60;
    for (let w = 0; w < warmSteps; ++w) engine.step(dt);

    const t0 = performance.now();
    for (let s = 0; s < stepCount; ++s) engine.step(dt);
    const t1 = performance.now();

    const totalMs = t1 - t0;
    const msPerStep = totalMs / stepCount;
    const usPerStep = msPerStep * 1000;

    return { totalMs, msPerStep, usPerStep };
}

async function main() {
    const factory = await loadFactory();
    const runCounts = args.some((a) => a.startsWith('--dice=')) ? [dieCount] : [10, 50, 100, 200];

    for (const n of runCounts) {
        const { totalMs, msPerStep, usPerStep } = runBench(factory, n, steps, warmup);
        console.log(
            `bench dice=${n} steps=${steps} warmup=${warmup} total_ms=${totalMs} ms_per_step=${msPerStep}`
        );
        console.log(
            `bench_json {"profile":"wasm-release","dice":${n},"steps":${steps},"warmup":${warmup},"total_ms":${totalMs},"ms_per_step":${msPerStep},"us_per_step":${usPerStep}}`
        );
    }
}

main().catch((err) => {
    console.error('[bench-solver-wasm]', err);
    process.exit(1);
});
