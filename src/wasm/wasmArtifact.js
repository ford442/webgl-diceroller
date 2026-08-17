import { publicAssetUrl } from '../core/publicAssetUrl.js';
import { supportsWasmSimd } from './simdSupport.js';

export const WASM_SIMD_DIR = 'wasm';
export const WASM_SCALAR_DIR = 'wasm-scalar';

/**
 * @param {URLSearchParams} [searchParams]
 * @returns {URLSearchParams}
 */
export function getPhysicsSearchParams(searchParams) {
    if (searchParams) return searchParams;
    if (typeof window !== 'undefined' && window.location?.search) {
        return new URLSearchParams(window.location.search);
    }
    return new URLSearchParams();
}

/**
 * @param {object} [options]
 * @param {URLSearchParams} [options.searchParams]
 * @param {(bytes: BufferSource) => boolean} [options.validate]
 * @returns {'wasm' | 'wasm-scalar'}
 */
export function resolveWasmArtifactDir(options = {}) {
    const searchParams = getPhysicsSearchParams(options.searchParams);
    if (searchParams.has('wasm-scalar')) return WASM_SCALAR_DIR;
    if (searchParams.has('wasm-simd')) return WASM_SIMD_DIR;
    return supportsWasmSimd(options.validate) ? WASM_SIMD_DIR : WASM_SCALAR_DIR;
}

/**
 * Ordered candidate dirs: preferred first, then the other build.
 * @param {'wasm' | 'wasm-scalar'} preferred
 * @returns {Array<'wasm' | 'wasm-scalar'>}
 */
export function wasmArtifactFallbackDirs(preferred) {
    if (preferred === WASM_SCALAR_DIR) return [WASM_SCALAR_DIR, WASM_SIMD_DIR];
    return [WASM_SIMD_DIR, WASM_SCALAR_DIR];
}

/**
 * Vite-busting dynamic import of the Emscripten ES module loader.
 * @param {string} dir
 * @returns {Promise<(opts?: object) => Promise<object>>}
 */
export async function importDicePhysicsLoader(dir) {
    const dynamicImport = new Function('u', 'return import(u)');
    const moduleFactory = await dynamicImport(publicAssetUrl(`${dir}/dice_physics.js`));
    return moduleFactory.default || moduleFactory;
}

/**
 * Instantiate the first available SIMD/scalar artifact.
 * @param {object} [options]
 * @param {URLSearchParams} [options.searchParams]
 * @param {(bytes: BufferSource) => boolean} [options.validate]
 * @param {string} [options.preferredDir]
 * @returns {Promise<{ Module: object, dir: string }>}
 */
export async function instantiateDicePhysicsModule(options = {}) {
    const requested = options.preferredDir;
    const preferred =
        requested === WASM_SCALAR_DIR || requested === WASM_SIMD_DIR
            ? requested
            : resolveWasmArtifactDir(options);
    let lastError = null;
    for (const dir of wasmArtifactFallbackDirs(preferred)) {
        try {
            const Factory = await importDicePhysicsLoader(dir);
            const Module = await Factory();
            return { Module, dir };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError ?? new Error('WASM dice physics artifacts not found');
}
