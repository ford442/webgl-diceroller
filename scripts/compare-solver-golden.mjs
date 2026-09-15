/**
 * compare-solver-golden.mjs — Native (and WASM, when present) golden traces.
 *
 * Usage:
 *   node scripts/compare-solver-golden.mjs [path/to/solver_tests]
 *
 * Fixture: tests/fixtures/solver-golden.json
 * Native dump: solver_tests --dump-golden
 */
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BIN = path.join(REPO_ROOT, 'src/wasm/build-native/solver_tests');
const FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/solver-golden.json');

const bin = process.argv[2] || DEFAULT_BIN;

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

function fnv1a64Hex(bytes) {
    let h = 14695981039346656037n;
    const p = 1099511628211n;
    const mask = (1n << 64n) - 1n;
    for (const b of bytes) {
        h ^= BigInt(b);
        h = (h * p) & mask;
    }
    return `0x${h.toString(16)}`;
}

function parseDump(stdout) {
    const traces = [];
    for (const line of stdout.split('\n')) {
        const idx = line.indexOf('golden_json ');
        if (idx < 0) continue;
        traces.push(JSON.parse(line.slice(idx + 'golden_json '.length)));
    }
    return traces;
}

const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
const { stdout } = await run(bin, ['--dump-golden']);
const dumped = parseDump(stdout);
if (dumped.length !== fixture.traces.length) {
    console.error(
        `[compare-solver-golden] expected ${fixture.traces.length} traces, dump produced ${dumped.length}`
    );
    process.exit(1);
}

let failed = 0;
for (let i = 0; i < fixture.traces.length; i++) {
    const want = fixture.traces[i];
    const got = dumped[i];
    if (got.name !== want.name || got.hash !== want.hash || got.revision !== fixture.revision) {
        console.error('[compare-solver-golden] mismatch', { want, got });
        failed++;
    }
}

if (failed) process.exit(1);
console.log('[compare-solver-golden] Native dump matches tests/fixtures/solver-golden.json');

const wasmJs = path.join(REPO_ROOT, 'public/wasm/dice_physics.js');
const wasmBin = path.join(REPO_ROOT, 'public/wasm/dice_physics.wasm');
try {
    await readFile(wasmJs);
    const wasmBinary = new Uint8Array(await readFile(wasmBin));
    const createModule = (await import(pathToFileURL(wasmJs).href)).default;
    const factory = await createModule({ wasmBinary });
    const engine = new factory.DicePhysicsEngine();
    engine.init(-15.0, -2.75, 18.0, 18.0);
    const id0 = engine.addDie(6, 0, 4, 0);
    const id1 = engine.addDie(20, 1.5, 5, -1.0);
    engine.applyImpulse(id0, 5, 2, -3);
    engine.applyTorqueImpulse(id1, 0, 10, 0);
    for (let i = 0; i < 30; i++) engine.step(1 / 60);
    const vec = engine.serializeState();
    const bytes = new Uint8Array(vec.size());
    for (let i = 0; i < vec.size(); i++) bytes[i] = vec.get(i);
    const hash = fnv1a64Hex(bytes);
    const want = fixture.traces.find((t) => t.name === 'parity-fixed')?.hash;
    if (hash !== want) {
        console.error(`[compare-solver-golden] WASM parity-fixed hash ${hash} != ${want}`);
        process.exit(1);
    }
    console.log('[compare-solver-golden] WASM parity-fixed hash matches fixture');
} catch {
    console.log(
        '[compare-solver-golden] Skipping WASM golden (public/wasm artifacts not present).'
    );
}
