#!/usr/bin/env node
/**
 * WASM is the only physics backend now (ammo.js was retired) — a bundle built
 * without both the SIMD (`public/wasm/`) and scalar (`public/wasm-scalar/`)
 * dice_physics artifacts ships some sessions with no dice simulation at all,
 * not a "fallback". `wasmArtifact.js` picks a preferred dir by SIMD support
 * and falls back to the other dir on failure, so a non-SIMD browser needs the
 * scalar build present just as much as a SIMD one needs the default build.
 * Fail `build:js` unless both are present, so that can't happen by accident.
 *
 * `npm run build` already runs `build:wasm` (needs Emscripten) first, whose
 * release default emits both directories. In an environment that only builds
 * the frontend (Cursor Cloud, a Codespace without Emscripten, this repo's own
 * AGENTS.md-documented limitation), pass `--allow-missing-wasm` to build the
 * JS bundle anyway — the app then shows PhysicsBootstrap's honest failure
 * screen at runtime instead of silently lacking dice.
 *
 * Usage: node scripts/check-wasm-artifacts.mjs [--allow-missing-wasm]
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const REQUIRED = [
    'public/wasm/dice_physics.js',
    'public/wasm/dice_physics.wasm',
    'public/wasm-scalar/dice_physics.js',
    'public/wasm-scalar/dice_physics.wasm',
];

const missing = REQUIRED.filter((rel) => !existsSync(resolve(ROOT, rel)));

if (missing.length === 0) {
    console.log('ok: WASM artifacts present (public/wasm{,-scalar}/dice_physics.{js,wasm})');
    process.exit(0);
}

const allowMissing = process.argv.includes('--allow-missing-wasm');

console[allowMissing ? 'warn' : 'error'](
    `${allowMissing ? 'WARN' : 'FAIL'}: missing WASM artifact(s):\n` +
        missing.map((rel) => `  - ${rel}`).join('\n') +
        '\n\nRun `npm run build:wasm` (requires Emscripten) first, or pass ' +
        '--allow-missing-wasm to build a frontend-only bundle that shows ' +
        "PhysicsBootstrap's failure screen instead of dice at runtime."
);

if (!allowMissing) {
    process.exit(1);
}
