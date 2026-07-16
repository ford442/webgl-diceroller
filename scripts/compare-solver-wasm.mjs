/**
 * compare-solver-wasm.mjs — Compare native serializeState() output with WASM.
 *
 * Usage:
 *   node scripts/compare-solver-wasm.mjs [path/to/solver_tests]
 *
 * Requires public/wasm/dice_physics.{js,wasm} (from npm run build:wasm).
 */
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = path.dirname(pathToFileURL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BIN = path.join(REPO_ROOT, 'src/wasm/build-native/solver_tests');
const PARITY_SEED = '0xDEADBEEFCAFEBABE';

const bin = process.argv[2] || DEFAULT_BIN;

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('close', (code) => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`${cmd} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
        });
    });
}

async function nativeSerializeHex(seed) {
    const { stdout } = await run(bin, ['--dump-serialize', seed]);
    return stdout.trim();
}

function runDeterministicScenario(engine, seedVal) {
    engine.init(-15.0, -2.75, 18.0, 18.0);
    engine.seedRNG(typeof seedVal === 'bigint' ? seedVal.toString() : String(seedVal));
    const sides = [4, 6, 8, 10, 12, 20];
    const cubeFlat = [
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    ];
    for (let i = 0; i < 6; i++) {
        const x = engine.randomFloat() * 4 - 2;
        const y = 3 + engine.randomFloat() * 2;
        const z = engine.randomFloat() * 4 - 2;
        const id = engine.addDie(sides[i % 6], x, y, z);
        engine.setDieHull(id, cubeFlat);
        engine.applyImpulse(id,
            (engine.randomFloat() - 0.5) * 50,
            engine.randomFloat() * 10,
            (engine.randomFloat() - 0.5) * 50);
        engine.applyTorqueImpulse(id,
            (engine.randomFloat() - 0.5) * 200,
            (engine.randomFloat() - 0.5) * 200,
            (engine.randomFloat() - 0.5) * 200);
    }
    for (let frame = 0; frame < 240; frame++) engine.step(1 / 60);
}

async function wasmSerializeHex(seed) {
    const wasmDir = path.join(REPO_ROOT, 'public/wasm');
    const jsPath = path.join(wasmDir, 'dice_physics.js');
    await readFile(jsPath);
    await readFile(path.join(wasmDir, 'dice_physics.wasm'));

    const createModule = (await import(pathToFileURL(jsPath).href)).default;
    const factory = await createModule({
        locateFile: (p) => path.join(wasmDir, p),
    });
    const engine = new factory.DicePhysicsEngine();
    runDeterministicScenario(engine, BigInt(seed));
    const vec = engine.serializeState();
    const bytes = new Uint8Array(vec.size());
    for (let i = 0; i < vec.size(); i++) bytes[i] = vec.get(i);
    return Buffer.from(bytes).toString('hex');
}

const nativeHex = await nativeSerializeHex(PARITY_SEED);
const wasmHex = await wasmSerializeHex(PARITY_SEED);

if (nativeHex !== wasmHex) {
    console.error('[compare-solver-wasm] Mismatch for seed', PARITY_SEED);
    console.error('  native length:', nativeHex.length / 2, 'bytes');
    console.error('  wasm   length:', wasmHex.length / 2, 'bytes');
    const minLen = Math.min(nativeHex.length, wasmHex.length);
    for (let i = 0; i < minLen; i += 2) {
        if (nativeHex.slice(i, i + 2) !== wasmHex.slice(i, i + 2)) {
            console.error(`  first diff at byte ${i / 2}: native=${nativeHex.slice(i, i + 2)} wasm=${wasmHex.slice(i, i + 2)}`);
            break;
        }
    }
    process.exit(1);
}

console.log('[compare-solver-wasm] Native and WASM serializeState() match for seed', PARITY_SEED);
