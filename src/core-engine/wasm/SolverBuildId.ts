/**
 * Runtime solver build identity from WASM artifact build-info.json.
 */

import { publicAssetUrl } from '../publicAssetUrl.js';
import { resolveWasmArtifactDir } from './wasmArtifact.js';

let cachedSolverBuildId: string | null = null;

/** `{solver_revision}:{git_sha}` from a parsed build-info.json. */
export function formatSolverBuildId(data: { git_sha?: string; solver_revision?: number }): string {
    const sha = String(data?.git_sha || '').trim();
    return `${data?.solver_revision ?? 0}:${sha || 'unknown'}`;
}

export async function loadSolverBuildId(searchParams?: URLSearchParams): Promise<string> {
    if (cachedSolverBuildId) return cachedSolverBuildId;
    const dir = resolveWasmArtifactDir({ searchParams });
    try {
        const res = await fetch(publicAssetUrl(`${dir}/build-info.json`), { cache: 'no-store' });
        if (!res.ok) return 'unknown';
        cachedSolverBuildId = formatSolverBuildId(await res.json());
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
