/**
 * Hand-rolled WASM SIMD128 probe via `WebAssembly.validate`.
 *
 * The payload is a minimal module whose only instruction is `v128.const`
 * (opcode `0xfd 0x0f`). Browsers without SIMD128 reject it at validate time
 * (Safari < 16.4, older WebViews) without instantiating a real engine.
 *
 * Bytes match the `simd` probe in GoogleChromeLabs/wasm-feature-detect.
 */

/** Minimal `(func () -> v128)` module containing `v128.const`. */
export const WASM_SIMD_PROBE_BYTES = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
    15, 26, 11,
]);

/**
 * @param {(bytes: BufferSource) => boolean} [validate] Injected `WebAssembly.validate`.
 *   When the argument is present but not a function, returns false (test hook).
 * @returns {boolean}
 */
export function supportsWasmSimd(validate) {
    const injected = arguments.length > 0;
    if (injected) {
        if (typeof validate !== 'function') return false;
        try {
            return !!validate(WASM_SIMD_PROBE_BYTES);
        } catch {
            return false;
        }
    }
    const fn =
        typeof WebAssembly !== 'undefined' && typeof WebAssembly.validate === 'function'
            ? WebAssembly.validate.bind(WebAssembly)
            : null;
    if (!fn) return false;
    try {
        return !!fn(WASM_SIMD_PROBE_BYTES);
    } catch {
        return false;
    }
}
