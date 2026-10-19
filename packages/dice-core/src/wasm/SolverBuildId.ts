/**
 * Solver build identity, from the artifact's build-info.json (src/wasm/build.sh).
 *
 * `solverBuildId = "${solver_revision}:${sha256(dice_physics.wasm)[0..12]}"`.
 * Content-addressed: two deploys of the same solver code from the same
 * toolchain share an id (a docs-only commit no longer splits rooms), and a
 * different compiler or SIMD-vs-scalar codegen gets a different one, because
 * the .wasm bytes differ. `emcc_version` and `simd` ride alongside for display.
 */

import { fetchAssetSource, type AssetSource } from '../assets/AssetSource.js';
import { resolveWasmArtifactDir } from './wasmArtifact.js';

export interface WasmBuildInfo {
    solver_revision?: number;
    /** Hex sha256 of the dice_physics.wasm next to this file. */
    wasm_sha256?: string;
    /** Pre-computed id (same formula); informational, recomputed on read. */
    solver_build_id?: string;
    emcc_version?: string;
    simd?: boolean;
    git_sha?: string;
}

/** Characters of the wasm sha256 kept in the id. */
export const SOLVER_BUILD_HASH_CHARS = 12;

/** `{solver_revision}:{sha256(wasm)[0..12]}` from a parsed build-info.json. */
export function formatSolverBuildId(data: WasmBuildInfo | null | undefined): string {
    const revision = data?.solver_revision ?? 0;
    const hash = String(data?.wasm_sha256 ?? '')
        .trim()
        .toLowerCase();
    if (/^[0-9a-f]{12,}$/.test(hash)) {
        return `${revision}:${hash.slice(0, SOLVER_BUILD_HASH_CHARS)}`;
    }
    // build-info.json written before build.sh hashed the artifact: the old,
    // git-sha-based id is the best this file can say.
    const sha = String(data?.git_sha ?? '').trim();
    return `${revision}:${sha ? `git-${sha}` : 'unknown'}`;
}

export async function loadWasmBuildInfo(
    dir: string,
    assets: AssetSource = fetchAssetSource()
): Promise<WasmBuildInfo> {
    return assets.json<WasmBuildInfo>(`${dir}/build-info.json`);
}

let cachedSolverBuildId: string | null = null;

export async function loadSolverBuildId(
    searchParams?: URLSearchParams,
    assets?: AssetSource
): Promise<string> {
    if (cachedSolverBuildId) return cachedSolverBuildId;
    const dir = resolveWasmArtifactDir({ searchParams });
    try {
        cachedSolverBuildId = formatSolverBuildId(await loadWasmBuildInfo(dir, assets));
    } catch {
        cachedSolverBuildId = 'unknown';
    }
    return cachedSolverBuildId;
}

export function getSolverBuildId(): string | null {
    return cachedSolverBuildId;
}

/** Test hook — do not use in production. */
export function _resetSolverBuildIdCache(): void {
    cachedSolverBuildId = null;
}
