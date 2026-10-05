import * as THREE from 'three';
import {
    DIE_PHYSICS_PRESETS,
    getDieSides as coreGetDieSides,
} from '../core-engine/wasm/physicsPresets.js';
import { isWasmAvailable } from '../wasm/PhysicsBridge.js';

/** WASM is the only dice physics backend; kept as a named check since callers
 * read it as "is the engine live yet", not "which backend". */
export const isUsingWasmPhysics = (): boolean => isWasmAvailable();

export const PHYSICS_PRESETS = DIE_PHYSICS_PRESETS;

export const getDieSides = (type: string): number => coreGetDieSides(type);

// The pipping centre-of-mass bias lives in the engine: DicePhysicsEngine derives
// each die's offset from its face table + hull and applies r × mg every
// substep. `?fair-dice` / `?bias-ratio=` are parsed in physicsFlags.ts.

export const getSecureRandom = (): number => {
    const array = new Uint32Array(1);
    const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
    cryptoObj?.getRandomValues(array);
    return (array[0] ?? 0) / (0xffffffff + 1);
};

export function estimateInertiaScalar(geometry: THREE.BufferGeometry, mass: number): number {
    const bbox = geometry.boundingBox ?? (geometry.computeBoundingBox?.(), geometry.boundingBox);
    const source = bbox || geometry.boundingBox;
    if (!source) return 0.4 * mass;

    const size = new THREE.Vector3();
    source.getSize(size);
    const ix = (mass / 12) * (size.y * size.y + size.z * size.z);
    const iy = (mass / 12) * (size.x * size.x + size.z * size.z);
    const iz = (mass / 12) * (size.x * size.x + size.y * size.y);
    return (ix + iy + iz) / 3;
}
