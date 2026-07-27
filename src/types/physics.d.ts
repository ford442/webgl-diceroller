// Cross-layer physics contracts — re-exports WASM engine surface plus bridge helpers.
export type {
    PhysicsEngine,
    PhysicsBridgeModule,
    CollisionEvent,
} from '../wasm/physicsTypes';

/** Six floats per plane: nx, ny, nz, d (same layout as WASM setContainerPlanes). */
export type ContainerPlanes = Float32Array | number[];
