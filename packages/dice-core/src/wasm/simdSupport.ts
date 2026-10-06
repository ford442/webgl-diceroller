/**
 * Hand-rolled WASM SIMD128 probe via `WebAssembly.validate`.
 *
 * The payload is a minimal module with one `(func (result v128))` whose body
 * is `i32.const 0; i8x16.splat` (opcode `0xfd 0x0f`). Engines without SIMD128
 * reject it at validate time (Safari < 16.4, older WebViews) without
 * instantiating a real engine.
 *
 * The previous bytes declared a v128 result and then `drop`ped it, with code
 * section sizes one byte too long, so they failed validation everywhere and
 * every runtime silently loaded the scalar build. `simd-support.test` now
 * validates these bytes with the real `WebAssembly.validate`.
 */

/** Minimal `(func (result v128) i32.const 0 i8x16.splat)` module. */
export const WASM_SIMD_PROBE_BYTES = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 8, 1, 6, 0, 65, 0, 253, 15,
    11,
]);

type ValidateFn = (bytes: BufferSource) => boolean;

/**
 * @param validate Injected `WebAssembly.validate`.
 *   When the argument is present but not a function, returns false (test hook).
 */
export function supportsWasmSimd(validate?: ValidateFn | null): boolean {
    const injected = arguments.length > 0 && validate !== undefined;
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
