/**
 * Node-only {@link AssetSource} over a `public/` directory on disk. Reached
 * through `dice-core/node`, or lazily from `rollHeadless()` when the caller
 * passes no source — never from the browser index.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    WASM_SIMD_DIR,
    wasmArtifactFallbackDirs,
    type WasmArtifactDir,
} from '../wasm/wasmArtifact.js';
import { AssetMissingError, type AssetSource } from './AssetSource.js';

/** The repo's `public/` (this file sits at packages/dice-core/{src,dist}/assets/). */
export function defaultPublicDir(fromUrl: string = import.meta.url): string {
    return path.resolve(path.dirname(fileURLToPath(fromUrl)), '../../../..', 'public');
}

export function fsAssetSource(publicDir: string = defaultPublicDir()): AssetSource {
    const resolve = (relativePath: string) => path.join(publicDir, relativePath);
    const read = async (relativePath: string): Promise<Buffer> => {
        try {
            return await readFile(resolve(relativePath));
        } catch (err) {
            throw new AssetMissingError(relativePath, publicDir, err);
        }
    };
    return {
        label: publicDir,
        async bytes(relativePath) {
            const buf = await read(relativePath);
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        },
        async json<T>(relativePath: string) {
            return JSON.parse((await read(relativePath)).toString('utf8')) as T;
        },
        moduleUrl: (relativePath) => pathToFileURL(resolve(relativePath)).href,
    };
}

/** Whether a compiled engine exists under `publicDir` (either build). */
export function wasmArtifactsPresent(
    publicDir: string = defaultPublicDir(),
    preferred: WasmArtifactDir = WASM_SIMD_DIR
): boolean {
    return wasmArtifactFallbackDirs(preferred).some((dir) =>
        existsSync(path.join(publicDir, dir, 'dice_physics.wasm'))
    );
}
