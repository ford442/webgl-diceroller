/**
 * Setup for the `dice-core-wasm` vitest project (`*.wasm.test.ts`).
 *
 * These tests exist to exercise the compiled engine, so a missing artifact is
 * a failure, never a skip: a run without `public/wasm*` used to report green
 * having rolled nothing. Locally, `npm run build:wasm` first; in CI the
 * `unit-wasm` job downloads the `wasm-artifacts` build.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defaultPublicDir } from 'dice-core/node';
import { WASM_SCALAR_DIR, WASM_SIMD_DIR } from 'dice-core/wasm/wasmArtifact';

const publicDir = defaultPublicDir();
const missing = [WASM_SIMD_DIR, WASM_SCALAR_DIR, 'wasm/hulls.json'].filter(
    (rel) =>
        !existsSync(path.join(publicDir, rel.endsWith('.json') ? rel : `${rel}/dice_physics.wasm`))
);
if (missing.length) {
    throw new Error(
        `dice-core-wasm needs both engine builds; missing ${missing.join(', ')} under ${publicDir}. ` +
            'Run `npm run build:wasm` (CI: download the wasm-artifacts artifact into public/).'
    );
}
