/**
 * Boot parameters the page hands the physics worker through `Worker#name`.
 *
 * A worker cannot tell where the app's `public/` lives: its own URL is the
 * bundled script under `assets/` (or a source path in dev), and a relative
 * Vite `base` resolved from there lands on the wrong directory — in a
 * subdirectory deploy (`/dice-roller/`) it dropped to the host root and every
 * `wasm/dice_physics.js` fetch 404'd. The page knows, so it resolves the
 * public root and passes it in, along with the SIMD/scalar artifact choice.
 */

import { WASM_SCALAR_DIR, WASM_SIMD_DIR, type WasmArtifactDir } from './wasmArtifact.js';

export interface WorkerBootParams {
    /** Preferred artifact dir; the worker still falls back to the other one. */
    dir?: WasmArtifactDir;
    /** Absolute URL of the app's public root (directory holding `wasm/`). */
    publicBase?: string;
}

const isArtifactDir = (value: unknown): value is WasmArtifactDir =>
    value === WASM_SIMD_DIR || value === WASM_SCALAR_DIR;

export function encodeWorkerBootName(params: WorkerBootParams): string {
    return JSON.stringify(params);
}

/** Accepts the JSON form and the bare artifact-dir name older pages sent. */
export function decodeWorkerBootName(name: string | undefined): WorkerBootParams {
    if (!name) return {};
    if (isArtifactDir(name)) return { dir: name };
    try {
        const parsed: unknown = JSON.parse(name);
        if (!parsed || typeof parsed !== 'object') return {};
        const { dir, publicBase } = parsed as Record<string, unknown>;
        return {
            ...(isArtifactDir(dir) ? { dir } : {}),
            ...(typeof publicBase === 'string' && publicBase ? { publicBase } : {}),
        };
    } catch {
        return {};
    }
}
