/**
 * Unit tests for the WASM SIMD128 probe and artifact-dir picker.
 */
import { describe, expect, it } from 'vitest';
import {
    WASM_SCALAR_DIR,
    WASM_SIMD_DIR,
    resolveWasmArtifactDir,
    wasmArtifactFallbackDirs,
} from '../../src/wasm/wasmArtifact.js';
import { WASM_SIMD_PROBE_BYTES, supportsWasmSimd } from '../../src/wasm/simdSupport.js';

describe('WASM SIMD probe', () => {
    it('probe bytes start with the wasm magic \\0asm', () => {
        expect(WASM_SIMD_PROBE_BYTES[0]).toBe(0);
        expect(WASM_SIMD_PROBE_BYTES[1]).toBe(97);
        expect(WASM_SIMD_PROBE_BYTES[2]).toBe(115);
        expect(WASM_SIMD_PROBE_BYTES[3]).toBe(109);
    });

    it('reports no SIMD when validate always returns false', () => {
        expect(supportsWasmSimd(() => false)).toBe(false);
    });

    it('reports SIMD when validate always returns true', () => {
        expect(supportsWasmSimd(() => true)).toBe(true);
    });

    it('passes the probe bytes to validate', () => {
        let seen = null;
        supportsWasmSimd((bytes) => {
            seen = bytes;
            return true;
        });
        expect(seen).toBe(WASM_SIMD_PROBE_BYTES);
    });

    it('treats a throwing validate as unsupported', () => {
        expect(
            supportsWasmSimd(() => {
                throw new Error('no simd');
            })
        ).toBe(false);
    });

    it('treats a missing validate function as unsupported', () => {
        expect(supportsWasmSimd(null)).toBe(false);
    });

    it('treats an omitted or undefined validate as native detection', () => {
        expect(supportsWasmSimd(undefined)).toBe(supportsWasmSimd());
    });
});

describe('resolveWasmArtifactDir', () => {
    it('picks the scalar dir when validate fails', () => {
        const dir = resolveWasmArtifactDir({
            searchParams: new URLSearchParams(''),
            validate: () => false,
        });
        expect(dir).toBe(WASM_SCALAR_DIR);
    });

    it('picks the SIMD dir when validate succeeds', () => {
        const dir = resolveWasmArtifactDir({
            searchParams: new URLSearchParams(''),
            validate: () => true,
        });
        expect(dir).toBe(WASM_SIMD_DIR);
    });

    it('?wasm-scalar forces scalar even when SIMD validates', () => {
        const dir = resolveWasmArtifactDir({
            searchParams: new URLSearchParams('wasm-scalar'),
            validate: () => true,
        });
        expect(dir).toBe(WASM_SCALAR_DIR);
    });

    it('?wasm-simd forces SIMD even when validate is false', () => {
        const dir = resolveWasmArtifactDir({
            searchParams: new URLSearchParams('wasm-simd'),
            validate: () => false,
        });
        expect(dir).toBe(WASM_SIMD_DIR);
    });
});

describe('wasmArtifactFallbackDirs', () => {
    it('tries the other artifact dir after the preferred one', () => {
        expect(wasmArtifactFallbackDirs(WASM_SIMD_DIR)).toEqual([WASM_SIMD_DIR, WASM_SCALAR_DIR]);
        expect(wasmArtifactFallbackDirs(WASM_SCALAR_DIR)).toEqual([WASM_SCALAR_DIR, WASM_SIMD_DIR]);
    });
});
