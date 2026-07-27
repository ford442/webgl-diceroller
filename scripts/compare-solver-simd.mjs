/**
 * compare-solver-simd.mjs — Scalar vs SIMD WASM serialize parity (fixed-literal scenario).
 *
 * Requires:
 *   public/wasm/dice_physics.{js,wasm}       (release, -msimd128)
 *   public/wasm-scalar/dice_physics.{js,wasm} (release-scalar, DICE_FORCE_SCALAR_SAT)
 *
 * Build scalar artifact:
 *   cd src/wasm && ./build.sh --scalar
 */
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function runParityScenario(engine) {
    engine.init(-15.0, -2.75, 18.0, 18.0);
    const id0 = engine.addDie(6, 0, 4, 0);
    const id1 = engine.addDie(20, 1.5, 5, -1.0);
    engine.applyImpulse(id0, 5, 2, -3);
    engine.applyTorqueImpulse(id1, 0, 10, 0);
    for (let i = 0; i < 30; i++) engine.step(1 / 60);
}

async function wasmSerializeHex(wasmDir) {
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

async function nativeSerializeHex() {
    const bin = path.join(REPO_ROOT, 'src/wasm/build-native/solver_tests');
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, ['--dump-serialize-parity'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => {
            stdout += d;
        });
        proc.stderr.on('data', (d) => {
            stderr += d;
        });
        proc.on('close', (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(`native parity dump failed: ${stderr || stdout}`));
        });
    });
}

const simdDir = path.join(REPO_ROOT, 'public/wasm');
const scalarDir = path.join(REPO_ROOT, 'public/wasm-scalar');

let scalarHex;
try {
    scalarHex = await wasmSerializeHex(scalarDir);
} catch (_err) {
    console.warn('[compare-solver-simd] Skipping — scalar WASM artifact missing.');
    console.warn('  Build with: cd src/wasm && ./build.sh --scalar');
    process.exit(0);
}

const simdHex = await wasmSerializeHex(simdDir);
const nativeHex = await nativeSerializeHex();

if (scalarHex !== simdHex) {
    console.error('[compare-solver-simd] Scalar vs SIMD WASM mismatch');
    const minLen = Math.min(scalarHex.length, simdHex.length);
    for (let i = 0; i < minLen; i += 2) {
        if (scalarHex.slice(i, i + 2) !== simdHex.slice(i, i + 2)) {
            console.error(
                `  first diff at byte ${i / 2}: scalar=${scalarHex.slice(i, i + 2)} simd=${simdHex.slice(i, i + 2)}`
            );
            break;
        }
    }
    process.exit(1);
}

console.log(
    '[compare-solver-simd] Scalar and SIMD WASM parity OK (' + simdHex.length / 2 + ' bytes)'
);

if (nativeHex !== simdHex) {
    console.warn('[compare-solver-simd] Native vs WASM mismatch (expected across toolchains)');
    console.warn('  native length:', nativeHex.length / 2, 'wasm length:', simdHex.length / 2);
} else {
    console.log('[compare-solver-simd] Native vs WASM also match on this host.');
}
