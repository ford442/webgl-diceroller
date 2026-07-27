export type StaticMaterialTag = 0 | 1 | 2 | 3 | 4;

export interface StaticColliderSpecBase {
    id?: number;
    materialTag?: StaticMaterialTag;
    offset?: { x?: number; y?: number; z?: number } | number[];
    rotation?: { x?: number; y?: number; z?: number } | number[];
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
    | StaticBoxSpec
    | StaticPlaneSpec
    | StaticOpenCylinderSpec
    | StaticConvexHullSpec;
