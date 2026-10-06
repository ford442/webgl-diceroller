import { fetchAssetSource, type AssetSource } from '../assets/AssetSource.js';
import type { DicePhysicsModule, EmbindVector } from './physicsTypes.js';
import type { HullData, HullTable } from './hullTypes.js';

/**
 * Pack hull face tables from hulls.json into a WASM VectorFloat.
 */
export function packFaceTableVector(
    moduleClass: DicePhysicsModule,
    hullData: HullData | null | undefined
): EmbindVector<number> {
    const vec = new moduleClass.VectorFloat();
    const faces = hullData?.faces;
    if (!faces?.length) return vec;

    for (const face of faces) {
        vec.push_back(face.normal[0] ?? 0);
        vec.push_back(face.normal[1] ?? 0);
        vec.push_back(face.normal[2] ?? 0);
        vec.push_back(face.value);
    }
    return vec;
}

/**
 * Upload face table for a die when hull metadata includes `faces`.
 */
export function applyFaceTableForDie(
    engine: { setDieFaceTable?: (id: number, packed: EmbindVector<number>) => void },
    moduleClass: DicePhysicsModule,
    wasmId: number,
    hullData: HullData | null | undefined
): void {
    if (!hullData?.faces?.length || typeof engine.setDieFaceTable !== 'function') return;
    const vec = packFaceTableVector(moduleClass, hullData);
    engine.setDieFaceTable(wasmId, vec);
    vec.delete?.();
}

/**
 * Upload a die's convex hull and face table from hulls.json. Shared by the
 * in-process bridge and the physics worker so the two cannot drift.
 */
export function uploadHullForDie(
    engine: {
        setDieHull: (id: number, vertices: EmbindVector<number>) => void;
        setDieFaceTable?: (id: number, packed: EmbindVector<number>) => void;
    },
    moduleClass: DicePhysicsModule,
    hulls: HullTable | null,
    wasmId: number,
    sides: number
): void {
    if (wasmId < 0 || !hulls) return;
    const data = hulls['d' + sides];
    if (!data?.vertices) return;
    const flat = new moduleClass.VectorFloat();
    for (const v of data.vertices) {
        if (!v) continue;
        flat.push_back(v[0] ?? 0);
        flat.push_back(v[1] ?? 0);
        flat.push_back(v[2] ?? 0);
    }
    engine.setDieHull(wasmId, flat);
    flat.delete?.();
    applyFaceTableForDie(engine, moduleClass, wasmId, data);
}

/** Every die shape the app spawns; each needs a hull and a face table. */
export const HULL_SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;

/**
 * Throw unless `table` has vertices and a face table for every shape. A die
 * without them collides as a bounding sphere and always reads face 0.
 */
export function assertCompleteHullTable(table: unknown, source: string): HullTable {
    const hulls = table as HullTable | null;
    const missing = HULL_SHAPES.filter((shape) => {
        const data = hulls?.[shape];
        return !data?.vertices?.length || !data.faces?.length;
    });
    if (!hulls || missing.length) {
        throw new Error(
            `hulls.json from ${source} has no hull/face table for ${missing.join(', ') || 'any shape'}`
        );
    }
    return hulls;
}

export interface LoadHullsOptions {
    assets?: AssetSource;
    /** Throw when hulls.json is missing or incomplete instead of returning null. */
    required?: boolean;
}

export async function loadHullTable(options: LoadHullsOptions = {}): Promise<HullTable | null> {
    const assets = options.assets ?? fetchAssetSource();
    try {
        return assertCompleteHullTable(await assets.json('wasm/hulls.json'), assets.label);
    } catch (e) {
        if (options.required) throw e;
        console.warn('[WasmPhysics] Could not load hulls.json — dice fall back to spheres:', e);
        return null;
    }
}
