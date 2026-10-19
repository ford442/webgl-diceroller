/** Convex-hull + face-table data shipped in `public/wasm/hulls.json`. */

export interface HullFace {
    normal: [number, number, number] | number[];
    value: number;
}

export interface HullData {
    vertices: [number, number, number][] | number[][];
    faces?: HullFace[];
}

export type HullTable = Record<string, HullData | undefined>;
