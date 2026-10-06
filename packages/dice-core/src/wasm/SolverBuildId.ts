/**
 * Runtime solver build identity from WASM artifact build-info.json.
 */

import { fetchAssetSource, type AssetSource } from '../assets/AssetSource.js';
import { resolveWasmArtifactDir } from './wasmArtifact.js';

let cachedSolverBuildId: string | null = null;

export interface BuildInfo {
    /** `<solver_revision>:<sha256(dice_physics.wasm)[:12]>`, written by build.sh. */
    solver_build_id?: string;
    solver_revision?: number;
    /** Display only since the id became content-addressed. */
    git_sha?: string;
}

/**
 * The id rooms compare at join. Content-addressed (`solver_build_id`, see
 * build.sh): same solver + same codegen → same id, whatever the commit.
 * Artifacts built before that field existed fall back to the old
 * `<solver_revision>:<git_sha>`.
 */
export function formatSolverBuildId(data: BuildInfo | null | undefined): string {
    const id = String(data?.solver_build_id || '').trim();
    if (id) return id;
    const sha = String(data?.git_sha || '').trim();
    return `${data?.solver_revision ?? 0}:${sha || 'unknown'}`;
}

/** Uncached: the id recorded next to the artifact in `dir`, or 'unknown'. */
export async function readSolverBuildId(assets: AssetSource, dir: string): Promise<string> {
    try {
        return formatSolverBuildId(await assets.json<BuildInfo>(`${dir}/build-info.json`));
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
