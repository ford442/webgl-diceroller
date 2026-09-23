/**
 * Physics backend selection (worker vs in-process vs stub).
 *
 * This module is DOM-free aside from optional `Worker` / `location.search`
 * detection via `globalThis`. Collider helpers that need Three.js stay in
 * `src/wasm/PhysicsBridge.ts`.
 */

import type { CollisionEvent, PhysicsBridgeModule, PhysicsEngine } from './physicsTypes.js';
import type { SeededDieRef } from './seededThrowParams.js';
import type { SeededHopperFrame } from './seededHopperDrop.js';
import { getPhysicsSearchParams } from './wasmArtifact.js';
import * as mainBridge from './WasmPhysicsBridge.js';
import * as workerBridge from './WorkerPhysicsBridge.js';

const _params = getPhysicsSearchParams();

const _forceMain =
    _params.has('no-wasm') || _params.has('no-worker') || _params.get('worker-physics') === 'off';

let active: PhysicsBridgeModule = mainBridge;

export const loadWasmEngine = async (): Promise<boolean> => {
    if (_forceMain || typeof Worker === 'undefined') {
        active = mainBridge;
        return active.loadWasmEngine();
    }

    const ok = await workerBridge.loadWasmEngine();
    if (ok) {
        active = workerBridge;
        return true;
    }

    console.warn('[PhysicsBridge] Worker backend unavailable — using main-thread WASM bridge.');
    active = mainBridge;
    return active.loadWasmEngine();
};

export const isWasmAvailable = (): boolean => active.isWasmAvailable();
export const isWasmInitialized = (): boolean => active.isWasmInitialized();
export const getWasmEngine = (): PhysicsEngine => active.getWasmEngine();
export const loadHullForDie = (wasmId: number, sides: number): void =>
    active.loadHullForDie(wasmId, sides);
export const pollCollisionEvents = (): CollisionEvent[] => active.pollCollisionEvents();
export const seedPhysicsRNG = (seed: number): void => active.seedPhysicsRNG(seed);
export const randomPhysicsFloat = (): number => active.randomPhysicsFloat();
export const serializePhysicsState = (): Promise<Uint8Array> => active.serializePhysicsState();
export const seededPhysicsThrow = (
    seed: number,
    dice: SeededDieRef[],
    tableSurfaceY: number
): void => active.seededPhysicsThrow(seed, dice, tableSurfaceY);
export const seededPhysicsHopperDrop = (
    seed: number,
    dice: SeededDieRef[],
    frame: SeededHopperFrame
): void => active.seededPhysicsHopperDrop(seed, dice, frame);
export const deserializePhysicsState = (data: Uint8Array): void =>
    active.deserializePhysicsState(data);
export const setContainerActive = (isActive: boolean): void => active.setContainerActive(isActive);
export const setContainerPlanes = (planes: Float32Array | number[]): void =>
    active.setContainerPlanes(planes);

export const isUsingWorkerPhysics = (): boolean => active === workerBridge;
export const isUsingSharedArrayBuffer = (): boolean =>
    active === workerBridge && workerBridge.isUsingSharedArrayBuffer();

export const flushWorkerCommandBatch = (): void => {
    if (active === workerBridge) workerBridge.flushWorkerCommandBatch();
};

export const getWorkerPhysicsStats = () =>
    active === workerBridge ? workerBridge.getWorkerPhysicsStats() : null;

export const getPhysicsStepStats = () => active.getPhysicsStepStats?.() ?? null;
