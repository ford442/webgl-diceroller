export type StaticMaterialTag = 0 | 1 | 2 | 3 | 4;

export interface StaticColliderSpecBase {
    id?: number;
    materialTag?: StaticMaterialTag;
    offset?: { x?: number; y?: number; z?: number } | number[];
    rotation?: { x?: number; y?: number; z?: number } | number[];
    /**
     * Opt this collider into the dynamic (movable) path instead of a static
     * body. Only 'box' and 'cylinder'/'openCylinder' (synthesized into a
     * convex prism hull) and 'convexHull' shapes support this — 'plane' does
     * not. Requires `mass` (> 0).
     */
    dynamic?: boolean;
    /** Body mass; required (> 0) when `dynamic` is true. */
    mass?: number;
}

export interface StaticBoxSpec extends StaticColliderSpecBase {
    type: 'box';
    halfExtents: [number, number, number];
}

export interface StaticPlaneSpec extends StaticColliderSpecBase {
    type: 'plane';
    normal: { x: number; y: number; z: number };
    dist: number;
}

export interface StaticOpenCylinderSpec extends StaticColliderSpecBase {
    type: 'cylinder' | 'openCylinder';
    radius: number;
    halfHeight?: number;
    height?: number;
    segments?: number;
    closedBottom?: boolean;
}

export interface StaticConvexHullSpec extends StaticColliderSpecBase {
    type: 'convexHull';
    vertices: number[][];
}

export type StaticColliderSpec =
    StaticBoxSpec | StaticPlaneSpec | StaticOpenCylinderSpec | StaticConvexHullSpec;
