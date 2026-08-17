/**
 * Pack hull face tables from hulls.json into a WASM VectorFloat.
 * @param {object} moduleClass — Emscripten module with VectorFloat
 * @param {{ faces?: Array<{ normal: number[]; value: number }> }} hullData
 */
export function packFaceTableVector(moduleClass, hullData) {
    const vec = new moduleClass.VectorFloat();
    const faces = hullData?.faces;
    if (!faces?.length) return vec;

    for (const face of faces) {
        vec.push_back(face.normal[0]);
        vec.push_back(face.normal[1]);
        vec.push_back(face.normal[2]);
        vec.push_back(face.value);
    }
    return vec;
}

/**
 * Upload face table for a die when hull metadata includes `faces`.
 * @param {object} engine
 * @param {object} moduleClass
 * @param {number} wasmId
 * @param {{ faces?: Array<{ normal: number[]; value: number }> }} hullData
 */
export function applyFaceTableForDie(engine, moduleClass, wasmId, hullData) {
    if (!hullData?.faces?.length || typeof engine.setDieFaceTable !== 'function') return;
    const vec = packFaceTableVector(moduleClass, hullData);
    engine.setDieFaceTable(wasmId, vec);
    if (typeof vec.delete === 'function') vec.delete();
}
