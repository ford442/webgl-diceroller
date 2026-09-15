/**
 * Runtime solver build identity from WASM artifact build-info.json.
 */

import { publicAssetUrl } from '../publicAssetUrl.js';
import { resolveWasmArtifactDir } from './wasmArtifact.js';

let cachedSolverBuildId: string | null = null;

export async function loadSolverBuildId(searchParams?: URLSearchParams): Promise<string> {
    if (cachedSolverBuildId) return cachedSolverBuildId;
    const dir = resolveWasmArtifactDir({ searchParams });
    try {
        const res = await fetch(publicAssetUrl(`${dir}/build-info.json`), { cache: 'no-store' });
        if (!res.ok) return 'unknown';
        const data = (await res.json()) as { git_sha?: string; solver_revision?: number };
        const sha = String(data?.git_sha || '').trim();
        cachedSolverBuildId = `${data?.solver_revision ?? 0}:${sha || 'unknown'}`;
        return cachedSolverBuildId;
    } catch {
        cachedSolverBuildId = 'unknown';
        return cachedSolverBuildId;
    }
}

export function getSolverBuildId(): string | null {
    return cachedSolverBuildId;
}

/** Test hook — do not use in production. */
export function _resetSolverBuildIdCache(): void {
    cachedSolverBuildId = null;
}
