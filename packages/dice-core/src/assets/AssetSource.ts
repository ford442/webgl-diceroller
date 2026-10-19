/**
 * AssetSource — the one seam through which dice-core reads `public/` assets
 * (the Emscripten glue + .wasm, hulls.json, build-info.json), in a page, in a
 * worker and in Node alike.
 *
 *   fetchAssetSource(base)   pages / workers: `fetch()` against a base URL
 *                            (defaults to Vite's BASE_URL via publicAssetUrl).
 *   fsAssetSource(publicDir) Node: `node:fs/promises`, reached through
 *                            `process.getBuiltinModule` so no `node:` import
 *                            ever enters the browser graph.
 *
 * Node's `fetch` does not implement `file:`, which is how `rollHeadless()`
 * used to lose its hull table and roll spheres. Nothing here swallows errors:
 * a missing asset rejects with `AssetNotFoundError`, and the caller decides
 * whether that asset was optional.
 */

import { publicAssetUrl } from '../publicAssetUrl.js';

export interface AssetSource {
    /**
     * URL for `relativePath` that a module loader can `import()` and that
     * Emscripten's `locateFile` can hand back (`https:`, `blob:` or `file:`).
     */
    url(relativePath: string): string;
    bytes(relativePath: string): Promise<Uint8Array>;
    json<T = unknown>(relativePath: string): Promise<T>;
    /**
     * True when the runtime's own loader can fetch `url()` (browser / worker),
     * so Emscripten may stream-compile the .wasm itself. False for `file:`
     * sources: the .wasm bytes are read here and passed as `wasmBinary`, which
     * also keeps a DOM shim (happy-dom) from steering Emscripten onto `fetch`.
     */
    readonly fetchable: boolean;
}

export class AssetNotFoundError extends Error {
    readonly relativePath: string;
    constructor(relativePath: string, location: string, cause?: unknown) {
        super(`Asset not found: ${relativePath} (${location})`, { cause });
        this.name = 'AssetNotFoundError';
        this.relativePath = relativePath;
    }
}

function normalize(relativePath: string): string {
    return relativePath.replace(/^\/+/, '');
}

/**
 * `fetch()`-backed source. `base` is either a URL (string or URL) that public
 * paths resolve against, or a resolver function; omitted, it uses the app's
 * `publicAssetUrl` (Vite BASE_URL + page/worker location).
 */
export function fetchAssetSource(
    base?: string | URL | ((relativePath: string) => string)
): AssetSource {
    const resolve =
        typeof base === 'function'
            ? base
            : base === undefined
              ? publicAssetUrl
              : (relativePath: string) => {
                    const root = String(base);
                    return new URL(relativePath, root.endsWith('/') ? root : `${root}/`).href;
                };
    const url = (relativePath: string) => resolve(normalize(relativePath));

    async function get(relativePath: string): Promise<Response> {
        const href = url(relativePath);
        let res: Response;
        try {
            // Revalidate: a stale build-info.json would misreport the solver build.
            res = await fetch(href, { cache: 'no-cache' } as RequestInit);
        } catch (err) {
            throw new AssetNotFoundError(relativePath, href, err);
        }
        if (!res.ok) throw new AssetNotFoundError(relativePath, `${href} → HTTP ${res.status}`);
        return res;
    }

    return {
        url,
        fetchable: true,
        async bytes(relativePath) {
            return new Uint8Array(await (await get(relativePath)).arrayBuffer());
        },
        async json<T>(relativePath: string) {
            return (await (await get(relativePath)).json()) as T;
        },
    };
}

type NodeBuiltins = {
    fs: typeof import('node:fs');
    fsp: typeof import('node:fs/promises');
    path: typeof import('node:path');
    url: typeof import('node:url');
};

/** Node's built-ins without an `import` statement a bundler would follow. */
export function nodeBuiltins(): NodeBuiltins | null {
    const proc = (globalThis as { process?: NodeJS.Process }).process;
    const load = proc?.getBuiltinModule?.bind(proc);
    if (typeof load !== 'function') return null;
    const fs = load('node:fs');
    const fsp = load('node:fs/promises');
    const path = load('node:path');
    const url = load('node:url');
    return fs && fsp && path && url ? { fs, fsp, path, url } : null;
}

function requireNodeBuiltins(): NodeBuiltins {
    const builtins = nodeBuiltins();
    if (!builtins) {
        throw new Error(
            'fsAssetSource needs Node ≥ 20.16 / 22.3 (process.getBuiltinModule); ' +
                'use fetchAssetSource() in a browser or worker.'
        );
    }
    return builtins;
}

/**
 * Filesystem-backed source rooted at `publicDir` (an absolute path or a
 * `file:` URL to the directory that holds `wasm/`, `wasm-scalar/`, …).
 */
export function fsAssetSource(publicDir: string | URL): AssetSource {
    const { fsp, path, url: nodeUrl } = requireNodeBuiltins();
    const root =
        publicDir instanceof URL || String(publicDir).startsWith('file:')
            ? nodeUrl.fileURLToPath(publicDir)
            : path.resolve(String(publicDir));
    const filePath = (relativePath: string) => path.join(root, normalize(relativePath));

    async function read(relativePath: string): Promise<Buffer> {
        const file = filePath(relativePath);
        try {
            return await fsp.readFile(file);
        } catch (err) {
            throw new AssetNotFoundError(relativePath, file, err);
        }
    }

    return {
        url: (relativePath) => nodeUrl.pathToFileURL(filePath(relativePath)).href,
        fetchable: false,
        async bytes(relativePath) {
            return new Uint8Array(await read(relativePath));
        },
        async json<T>(relativePath: string) {
            return JSON.parse((await read(relativePath)).toString('utf8')) as T;
        },
    };
}
