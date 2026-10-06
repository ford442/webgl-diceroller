/**
 * One seam for reading the engine's shipped assets (the Emscripten glue and
 * `.wasm`, `hulls.json`, `build-info.json`) wherever the engine runs.
 *
 *   - pages and the physics worker: {@link fetchAssetSource}
 *   - Node (rollHeadless, harnesses): `fsAssetSource` from `dice-core/node`
 *
 * Paths are relative to the deploy's `public/` directory, e.g.
 * `wasm/hulls.json`. Every method rejects when the asset is missing; callers
 * decide whether that is fatal.
 */

import { publicAssetUrl } from '../publicAssetUrl.js';

export interface AssetSource {
    /** Short description for error messages (a base URL or a directory). */
    readonly label: string;
    bytes(relativePath: string): Promise<Uint8Array>;
    json<T = unknown>(relativePath: string): Promise<T>;
    /** URL to `import()` an ES module from (the Emscripten glue). */
    moduleUrl(relativePath: string): string;
    /**
     * An HTTP(S) URL a streaming consumer may fetch itself. Present only on
     * fetch-backed sources, so the browser keeps `instantiateStreaming`;
     * anything else is handed the bytes.
     */
    streamingUrl?(relativePath: string): string;
}

export class AssetMissingError extends Error {
    constructor(
        readonly relativePath: string,
        source: string,
        cause?: unknown
    ) {
        super(`Asset ${relativePath} not available from ${source}`, { cause });
        this.name = 'AssetMissingError';
    }
}

export interface FetchAssetSourceOptions {
    /** `RequestInit.cache` for every request (e.g. `no-store` for build-info). */
    cache?: RequestCache;
}

/** Assets served over HTTP next to the page or worker (Vite `base`-aware by default). */
export function fetchAssetSource(
    urlFor: (relativePath: string) => string = publicAssetUrl,
    options: FetchAssetSourceOptions = {}
): AssetSource {
    const init: RequestInit | undefined = options.cache ? { cache: options.cache } : undefined;
    const get = async (relativePath: string): Promise<Response> => {
        const url = urlFor(relativePath);
        let res: Response;
        try {
            res = await fetch(url, init);
        } catch (err) {
            throw new AssetMissingError(relativePath, url, err);
        }
        if (!res.ok) throw new AssetMissingError(relativePath, `${url} (HTTP ${res.status})`);
        return res;
    };
    return {
        label: urlFor(''),
        async bytes(relativePath) {
            return new Uint8Array(await (await get(relativePath)).arrayBuffer());
        },
        async json<T>(relativePath: string) {
            return (await (await get(relativePath)).json()) as T;
        },
        moduleUrl: urlFor,
        streamingUrl: urlFor,
    };
}
