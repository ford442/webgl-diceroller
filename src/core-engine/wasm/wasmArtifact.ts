import { publicAssetUrl } from '../publicAssetUrl.js';
import type { DicePhysicsModule } from './physicsTypes.js';
import { supportsWasmSimd } from './simdSupport.js';

export const WASM_SIMD_DIR = 'wasm';
export const WASM_SCALAR_DIR = 'wasm-scalar';

export type WasmArtifactDir = typeof WASM_SIMD_DIR | typeof WASM_SCALAR_DIR;

export type WasmSimdValidate = (bytes: BufferSource) => boolean;

export type DicePhysicsFactory = (
    moduleArg?: Record<string, unknown>
) => Promise<DicePhysicsModule>;

export function getPhysicsSearchParams(searchParams?: URLSearchParams): URLSearchParams {
    if (searchParams) return searchParams;
    const href =
        typeof globalThis !== 'undefined' &&
        'location' in globalThis &&
        (globalThis as { location?: { search?: string } }).location?.search;
    if (href) return new URLSearchParams(href);
    return new URLSearchParams();
}

export interface ResolveWasmArtifactDirOptions {
    searchParams?: URLSearchParams;
    validate?: WasmSimdValidate;
}

export function resolveWasmArtifactDir(
    options: ResolveWasmArtifactDirOptions = {}
): WasmArtifactDir {
    const searchParams = getPhysicsSearchParams(options.searchParams);
    if (searchParams.has('wasm-scalar')) return WASM_SCALAR_DIR;
    if (searchParams.has('wasm-simd')) return WASM_SIMD_DIR;
    return supportsWasmSimd(options.validate) ? WASM_SIMD_DIR : WASM_SCALAR_DIR;
}

/** Ordered candidate dirs: preferred first, then the other build. */
export function wasmArtifactFallbackDirs(preferred: WasmArtifactDir): WasmArtifactDir[] {
    if (preferred === WASM_SCALAR_DIR) return [WASM_SCALAR_DIR, WASM_SIMD_DIR];
    return [WASM_SIMD_DIR, WASM_SCALAR_DIR];
}

export interface InstantiateDicePhysicsOptions extends ResolveWasmArtifactDirOptions {
    preferredDir?: string;
    /** Override URL resolution (Node file: URLs, custom hosts). */
    assetUrl?: (relativePath: string) => string;
    locateFile?: (path: string, prefix?: string) => string;
    moduleArgs?: Record<string, unknown>;
}

/**
 * Vite-busting dynamic import of the Emscripten ES module loader.
 *
 * The glue is built with `MODULARIZE=1 -s EXPORT_ES6=1`, so it is an ES module
 * whose default export is the factory. Where that lands depends on who is
 * doing the importing:
 *
 *   - browser / plain Node: `namespace.default` is the factory.
 *   - a CJS transpiling loader (tsx, ts-node) running a `.js` file in a
 *     package with no `"type": "module"`: the module is rewritten to CommonJS
 *     first, so the namespace is `{ default: { default: factory } }` and the
 *     factory sits one level deeper.
 *
 * Unwrapping both shapes keeps the Node-side harnesses (`rollHeadless`,
 * `verify:tower-drop-replay`) working under tsx. Without it they fell back to
 * the JS stub and quietly simulated nothing.
 */
export function resolveDicePhysicsFactory(namespace: unknown): DicePhysicsFactory | null {
    const ns = namespace as { default?: unknown } | undefined;
    const interopDefault = (ns?.default as { default?: unknown } | undefined)?.default;
    const factory = [ns?.default, interopDefault, namespace].find(
        (candidate) => typeof candidate === 'function'
    );
    return typeof factory === 'function' ? (factory as DicePhysicsFactory) : null;
}

export async function importDicePhysicsLoader(
    dir: string,
    assetUrl: (relativePath: string) => string = publicAssetUrl
): Promise<DicePhysicsFactory> {
    const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<unknown>;
    const namespace = await dynamicImport(assetUrl(`${dir}/dice_physics.js`));
    const factory = resolveDicePhysicsFactory(namespace);
    if (!factory) {
        throw new Error(`dice_physics.js in ${dir} did not export a module factory`);
    }
    return factory;
}

/**
 * Instantiate the first available SIMD/scalar artifact.
 */
export async function instantiateDicePhysicsModule(
    options: InstantiateDicePhysicsOptions = {}
): Promise<{ Module: DicePhysicsModule; dir: WasmArtifactDir }> {
    const requested = options.preferredDir;
    const preferred: WasmArtifactDir =
        requested === WASM_SCALAR_DIR || requested === WASM_SIMD_DIR
            ? requested
            : resolveWasmArtifactDir(options);
    const assetUrl = options.assetUrl ?? publicAssetUrl;
    let lastError: unknown = null;
    for (const dir of wasmArtifactFallbackDirs(preferred)) {
        try {
            const Factory = await importDicePhysicsLoader(dir, assetUrl);
            const moduleArgs: Record<string, unknown> = { ...options.moduleArgs };
            moduleArgs.locateFile =
                options.locateFile ??
                ((file: string) => {
                    const name = file.split(/[/\\]/).pop() ?? file;
                    return assetUrl(`${dir}/${name}`);
                });
            const Module = await Factory(moduleArgs);
            return { Module, dir };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError ?? new Error('WASM dice physics artifacts not found');
}
