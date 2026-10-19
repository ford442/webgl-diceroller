import type { DicePhysicsModule, EmbindVector } from './physicsTypes.js';
import type { HullData } from './hullTypes.js';

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
