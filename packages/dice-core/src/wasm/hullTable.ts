import { fetchAssetSource, type AssetSource } from '../assets/AssetSource.js';
import type { HullTable } from './hullTypes.js';

export const HULL_TABLE_PATH = 'wasm/hulls.json';

/**
 * Convex hulls + face tables for every die shape. Rejects (AssetNotFoundError
 * or a JSON error) when the table is missing — callers that can live with
 * bounding spheres say so explicitly (`requireHulls: false`).
 */
export async function loadHullTable(assets: AssetSource = fetchAssetSource()): Promise<HullTable> {
    const table = await assets.json<HullTable>(HULL_TABLE_PATH);
    if (!table || typeof table !== 'object') {
        throw new Error(`${HULL_TABLE_PATH} is not a hull table`);
    }
    return table;
}
