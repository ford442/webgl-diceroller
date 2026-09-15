/**
 * Page-facing physics façade: core-engine backend selection plus Three.js
 * collider registration (static/dynamic props, table bounds).
 */

export {
    deserializePhysicsState,
    flushWorkerCommandBatch,
    getPhysicsStepStats,
    getWasmEngine,
    getWorkerPhysicsStats,
    isUsingSharedArrayBuffer,
    isUsingWorkerPhysics,
    isWasmAvailable,
    isWasmInitialized,
    loadHullForDie,
    loadWasmEngine,
    pollCollisionEvents,
    randomPhysicsFloat,
    seedPhysicsRNG,
    seededPhysicsThrow,
    serializePhysicsState,
    setContainerActive,
    setContainerPlanes,
} from '../core-engine/wasm/PhysicsBridge.js';

import type { Object3D } from 'three';
import { getWasmEngine, isWasmAvailable } from '../core-engine/wasm/PhysicsBridge.js';
import { addDynamicColliderForEngine, removeDynamicColliderForEngine } from './dynamicColliders.js';
import {
    addStaticColliderForEngine,
    clearStaticCollidersForEngine,
    createWasmTableBoundsForEngine,
    removeStaticColliderForEngine,
} from './staticColliders.js';
import type { StaticColliderSpec } from '../types/staticCollider.js';

/** Register a declarative static collider spec in the WASM engine. */
export const addStaticCollider = (spec: StaticColliderSpec, anchor: Object3D): number => {
    if (!isWasmAvailable()) return -1;
    return addStaticColliderForEngine(getWasmEngine(), spec, anchor);
};

export const removeStaticCollider = (userId: number): boolean => {
    if (!isWasmAvailable()) return false;
    return removeStaticColliderForEngine(getWasmEngine(), userId);
};

export const clearStaticColliders = (): void => {
    if (!isWasmAvailable()) return;
    clearStaticCollidersForEngine(getWasmEngine());
};

/** Upload Table.js physicsBodies as WASM static boxes (walls, velvet zone, lips). */
export const createWasmTableBounds = (
    tableConfig: Parameters<typeof createWasmTableBoundsForEngine>[1]
): number => {
    if (!isWasmAvailable()) return 0;
    return createWasmTableBoundsForEngine(getWasmEngine(), tableConfig);
};

/** Register a declarative dynamic (movable) collider spec in the WASM engine. */
export const addDynamicCollider = (spec: StaticColliderSpec, anchor: Object3D): number => {
    if (!isWasmAvailable()) return -1;
    return addDynamicColliderForEngine(getWasmEngine(), spec, anchor);
};

export const removeDynamicCollider = (userId: number): boolean => {
    if (!isWasmAvailable()) return false;
    return removeDynamicColliderForEngine(getWasmEngine(), userId);
};
