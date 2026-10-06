/**
 * Runtime solver build identity from WASM artifact build-info.json.
 */

import { fetchAssetSource, type AssetSource } from '../assets/AssetSource.js';
import { resolveWasmArtifactDir } from './wasmArtifact.js';

let cachedSolverBuildId: string | null = null;

/** `{solver_revision}:{git_sha}` from a parsed build-info.json. */
export function formatSolverBuildId(data: { git_sha?: string; solver_revision?: number }): string {
    const sha = String(data?.git_sha || '').trim();
    return `${data?.solver_revision ?? 0}:${sha || 'unknown'}`;
}

/** Uncached: the id recorded next to the artifact in `dir`, or 'unknown'. */
export async function readSolverBuildId(assets: AssetSource, dir: string): Promise<string> {
    try {
        return formatSolverBuildId(await assets.json(`${dir}/build-info.json`));
    } catch {
        return 'unknown';
    }
}

export async function loadSolverBuildId(
    searchParams?: URLSearchParams,
    assets: AssetSource = fetchAssetSource(undefined, { cache: 'no-store' })
): Promise<string> {
    if (cachedSolverBuildId) return cachedSolverBuildId;
    cachedSolverBuildId = await readSolverBuildId(assets, resolveWasmArtifactDir({ searchParams }));
    return cachedSolverBuildId;
}

export function getSolverBuildId(): string | null {
    return cachedSolverBuildId;
}

/** Test hook — do not use in production. */
export function _resetSolverBuildIdCache(): void {
    cachedSolverBuildId = null;
}
