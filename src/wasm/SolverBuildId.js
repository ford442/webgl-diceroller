/**
 * Runtime solver build identity from WASM artifact build-info.json.
 */

import { publicAssetUrl } from '../core/publicAssetUrl.js';
import { resolveWasmArtifactDir } from './wasmArtifact.js';

/** @type {string | null} */
let cachedSolverBuildId = null;

/**
 * @param {URLSearchParams} [searchParams]
 * @returns {Promise<string>}
 */
export async function loadSolverBuildId(searchParams) {
    if (cachedSolverBuildId) return cachedSolverBuildId;
    const dir = resolveWasmArtifactDir({ searchParams });
    try {
        const res = await fetch(publicAssetUrl(`${dir}/build-info.json`), { cache: 'no-store' });
        if (!res.ok) return 'unknown';
        const data = await res.json();
        const sha = String(data?.git_sha || '').trim();
        cachedSolverBuildId = sha || 'unknown';
        return cachedSolverBuildId;
    } catch {
        cachedSolverBuildId = 'unknown';
        return cachedSolverBuildId;
    }
}

/**
 * @returns {string | null}
 */
export function getSolverBuildId() {
    return cachedSolverBuildId;
}
