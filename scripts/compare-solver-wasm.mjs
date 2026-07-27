/**
 * compare-solver-wasm.mjs — Compare native serializeState() output with WASM.
 *
 * Usage:
 *   node scripts/compare-solver-wasm.mjs [path/to/solver_tests]
 *
 * Requires public/wasm/dice_physics.{js,wasm} (from npm run build:wasm).
 *
 * Uses a fixed-literal scenario (no PRNG) so g++/clang/emscripten agree on
 * IEEE-754 results; the older seeded 240-frame scenario can diverge across toolchains.
 */
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BIN = path.join(REPO_ROOT, 'src/wasm/build-native/solver_tests');

const bin = process.argv[2] || DEFAULT_BIN;

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => {
            stdout += d;
        });
        proc.stderr.on('data', (d) => {
            stderr += d;
        });
        proc.on('close', (code) => {
            if (code === 0) resolve({ stdout, stderr });
            else
                reject(new Error(`${cmd} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
        });
    });
}

async function nativeSerializeHex() {
    const { stdout } = await run(bin, ['--dump-serialize-parity']);
    return stdout.trim();
}

function runParityScenario(engine) {
    engine.init(-15.0, -2.75, 18.0, 18.0);
    const id0 = engine.addDie(6, 0, 4, 0);
    const id1 = engine.addDie(20, 1.5, 5, -1.0);
    engine.applyImpulse(id0, 5, 2, -3);
    engine.applyTorqueImpulse(id1, 0, 10, 0);
    for (let i = 0; i < 30; i++) engine.step(1 / 60);
}

async function wasmSerializeHex() {
    const wasmDir = path.join(REPO_ROOT, 'public/wasm');
    const jsPath = path.join(wasmDir, 'dice_physics.js');
    const wasmPath = path.join(wasmDir, 'dice_physics.wasm');
    await readFile(jsPath);
    const wasmBinary = new Uint8Array(await readFile(wasmPath));

    const createModule = (await import(pathToFileURL(jsPath).href)).default;
    const factory = await createModule({ wasmBinary });
    const engine = new factory.DicePhysicsEngine();
    runParityScenario(engine);
    const vec = engine.serializeState();
    const bytes = new Uint8Array(vec.size());
    for (let i = 0; i < vec.size(); i++) bytes[i] = vec.get(i);
    return Buffer.from(bytes).toString('hex');
}

const nativeHex = await nativeSerializeHex();
const wasmHex = await wasmSerializeHex();

if (nativeHex !== wasmHex) {
    console.error('[compare-solver-wasm] Mismatch in fixed parity scenario');
    console.error('  native length:', nativeHex.length / 2, 'bytes');
    console.error('  wasm   length:', wasmHex.length / 2, 'bytes');
    const minLen = Math.min(nativeHex.length, wasmHex.length);
    for (let i = 0; i < minLen; i += 2) {
        if (nativeHex.slice(i, i + 2) !== wasmHex.slice(i, i + 2)) {
            console.error(
                `  first diff at byte ${i / 2}: native=${nativeHex.slice(i, i + 2)} wasm=${wasmHex.slice(i, i + 2)}`
            );
            break;
        }
    }
    process.exit(1);
}

console.log('[compare-solver-wasm] Native and WASM serializeState() match (fixed parity scenario)');
