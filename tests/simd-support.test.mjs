/**
 * Unit tests for the WASM SIMD128 probe and artifact-dir picker.
 * Run: node tests/simd-support.test.mjs
 */
import assert from 'node:assert/strict';
import { supportsWasmSimd, WASM_SIMD_PROBE_BYTES } from '../src/wasm/simdSupport.js';
import {
    resolveWasmArtifactDir,
    wasmArtifactFallbackDirs,
    WASM_SCALAR_DIR,
    WASM_SIMD_DIR,
} from '../src/wasm/wasmArtifact.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

console.log('WASM SIMD probe tests\n');

test('probe bytes start with the wasm magic \\0asm', () => {
    assert.equal(WASM_SIMD_PROBE_BYTES[0], 0);
    assert.equal(WASM_SIMD_PROBE_BYTES[1], 97);
    assert.equal(WASM_SIMD_PROBE_BYTES[2], 115);
    assert.equal(WASM_SIMD_PROBE_BYTES[3], 109);
});

test('fake validate that always returns false → no SIMD', () => {
    assert.equal(
        supportsWasmSimd(() => false),
        false
    );
});

test('fake validate that always returns true → SIMD', () => {
    assert.equal(
        supportsWasmSimd(() => true),
        true
    );
});

test('fake validate receives the probe bytes', () => {
    let seen = null;
    supportsWasmSimd((bytes) => {
        seen = bytes;
        return true;
    });
    assert.equal(seen, WASM_SIMD_PROBE_BYTES);
});

test('validate throwing is treated as unsupported', () => {
    assert.equal(
        supportsWasmSimd(() => {
            throw new Error('no simd');
        }),
        false
    );
});

test('missing validate function (null) → unsupported', () => {
    assert.equal(supportsWasmSimd(null), false);
});

test('non-SIMD validate picks scalar artifact dir', () => {
    const dir = resolveWasmArtifactDir({
        searchParams: new URLSearchParams(''),
        validate: () => false,
    });
    assert.equal(dir, WASM_SCALAR_DIR);
});

test('SIMD validate picks simd artifact dir', () => {
    const dir = resolveWasmArtifactDir({
        searchParams: new URLSearchParams(''),
        validate: () => true,
    });
    assert.equal(dir, WASM_SIMD_DIR);
});

test('?wasm-scalar forces scalar even when SIMD validates', () => {
    const dir = resolveWasmArtifactDir({
        searchParams: new URLSearchParams('wasm-scalar'),
        validate: () => true,
    });
    assert.equal(dir, WASM_SCALAR_DIR);
});

test('?wasm-simd forces simd even when validate is false', () => {
    const dir = resolveWasmArtifactDir({
        searchParams: new URLSearchParams('wasm-simd'),
        validate: () => false,
    });
    assert.equal(dir, WASM_SIMD_DIR);
});

test('fallback dirs try the other artifact after the preferred one', () => {
    assert.deepEqual(wasmArtifactFallbackDirs(WASM_SIMD_DIR), [WASM_SIMD_DIR, WASM_SCALAR_DIR]);
    assert.deepEqual(wasmArtifactFallbackDirs(WASM_SCALAR_DIR), [WASM_SCALAR_DIR, WASM_SIMD_DIR]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
