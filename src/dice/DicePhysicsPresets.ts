import * as THREE from 'three';
import {
    DIE_PHYSICS_PRESETS,
    getDieSides as coreGetDieSides,
} from '../core-engine/wasm/physicsPresets.js';
import type { SpawnedDie } from '../types/dice.js';
import type { PhysicsPreset } from '../types/physicsPresets.js';
import { getWasmEngine, isWasmAvailable } from '../wasm/PhysicsBridge.js';
import { spawnedDice } from './DiceState.js';

const searchParams =
    typeof globalThis !== 'undefined' && 'location' in globalThis
        ? new URLSearchParams(
              (globalThis as { location?: { search?: string } }).location?.search ?? ''
          )
        : new URLSearchParams();

/** WASM is the only dice physics backend; kept as a named check since callers
 * read it as "is the engine live yet", not "which backend". */
export const isUsingWasmPhysics = (): boolean => isWasmAvailable();

export const DEFAULT_MASS_BIAS_RATIO = 0.0075;

export const PHYSICS_PRESETS = DIE_PHYSICS_PRESETS;

export const getMassBiasRatio = (): number => {
    const raw = searchParams.get('bias-ratio');
    if (raw === null) return DEFAULT_MASS_BIAS_RATIO;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(value, 0.05)) : DEFAULT_MASS_BIAS_RATIO;
};

export const getDieSides = (type: string): number => coreGetDieSides(type);

export const useMassBias = (): boolean => !searchParams.has('fair-dice');

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

export function getCenterOfMassOffset(die: SpawnedDie | null | undefined): THREE.Vector3 | null {
    const offset = die?.centerOfMassOffset ?? die?.mesh?.userData?.centerOfMassOffset;
    if (!offset) return null;
    return offset;
}

export function getGeometryPositionFromBodyTransform(
    die: SpawnedDie,
    origin: { x: () => number; y: () => number; z: () => number },
    quaternion: THREE.Quaternion
): { x: number; y: number; z: number } {
    const offset = getCenterOfMassOffset(die);
    if (!offset) {
        return { x: origin.x(), y: origin.y(), z: origin.z() };
    }

    const worldOffset = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion);
    return {
        x: origin.x() - worldOffset.x,
        y: origin.y() - worldOffset.y,
        z: origin.z() - worldOffset.z,
    };
}

export function getBodyPositionFromGeometry(
    position: { x: number; y: number; z: number },
    quaternion: THREE.Quaternion,
    offset: { x: number; y: number; z: number } | null | undefined
): { x: number; y: number; z: number } {
    if (!offset) return position;
    const worldOffset = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion);
    return {
        x: position.x + worldOffset.x,
        y: position.y + worldOffset.y,
        z: position.z + worldOffset.z,
    };
}

export const applyDiceMassBiases = ({ deltaTime = 1 / 60 }: { deltaTime?: number } = {}): void => {
    if (!useMassBias()) return;
    if (!isUsingWasmPhysics()) return;

    const engine = getWasmEngine();
    const gravityForce = new THREE.Vector3(0, -15, 0);
    const worldOffset = new THREE.Vector3();
    const torque = new THREE.Vector3();

    spawnedDice.forEach((die) => {
        if (!die.massBiasOffset || die.wasmId == null) return;

        worldOffset.copy(die.massBiasOffset).applyQuaternion(die.mesh.quaternion);
        const preset: PhysicsPreset | undefined = die.physicsPreset;
        torque.crossVectors(worldOffset, gravityForce).multiplyScalar(preset?.mass ?? 5);
        if (torque.lengthSq() < 1e-8) return;

        engine.applyTorqueImpulse(
            die.wasmId,
            torque.x * deltaTime,
            torque.y * deltaTime,
            torque.z * deltaTime
        );
    });
};
