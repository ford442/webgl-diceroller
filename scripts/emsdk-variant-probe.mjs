#!/usr/bin/env node
/**
 * emsdk-variant-probe.mjs — Load one built dice_physics artifact and print a
 * deterministic fingerprint of its behaviour.
 *
 * Used by scripts/emsdk-flag-experiment.sh. A link flag like `--closure 1` or
 * `-s STRICT=1` can compile clean and still break the Embind glue at *load*
 * time (missing runtime method, mangled export name), and `-fno-rtti` can break
 * Embind's type registry without any diagnostic at all. Compiling is therefore
 * not evidence that a flag is usable — running is.
 *
 * The scenario mirrors scripts/compare-solver-simd.mjs so the hex it prints is
 * directly comparable to the baseline variant's.
 *
 * Usage:  node scripts/emsdk-variant-probe.mjs <dir containing dice_physics.js>
 * Output: one line, `serialize=<hex> faces=<csv> draw=<float>`, or a non-zero exit.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const dir = process.argv[2];
if (!dir) {
    console.error('usage: emsdk-variant-probe.mjs <wasm-dir>');
    process.exit(2);
}

const jsPath = path.resolve(dir, 'dice_physics.js');
const wasmPath = path.resolve(dir, 'dice_physics.wasm');

const wasmBinary = new Uint8Array(await readFile(wasmPath));
await readFile(jsPath);
const createModule = (await import(pathToFileURL(jsPath).href)).default;
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

// getFaceValues returns an emscripten::val typed_memory_view rather than a
// registered vector, and seedRNG takes a uint64_t (WASM_BIGINT). Both are
// binding shapes that --closure / -s STRICT / -fno-rtti break differently from
// serializeState, so probe all three rather than trusting one.
const faces = Array.from(engine.getFaceValues());
engine.seedRNG(0x0123456789abcdefn);
const draw = engine.randomFloat();

console.log(
    `serialize=${Buffer.from(bytes).toString('hex')} faces=${faces.join(',')} draw=${draw}`
);
