import * as THREE from 'three';
import type { SpawnedDie } from '../types/dice.js';
import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';

export const WASM_TRANSFORM_STRIDE = 7;

export interface WasmDieTransform {
    x: number;
    y: number;
    z: number;
    qx: number;
    qy: number;
    qz: number;
    qw: number;
}

const _readQ = new THREE.Quaternion();

export function getWasmTransformForDie(wasmId: number): WasmDieTransform | null {
    const engine = getWasmEngine();
    if (typeof engine.getDieIds !== 'function') return null;

    const transforms = engine.getTransforms();
    const ids = engine.getDieIds();
    if (!transforms?.length || !ids?.length) return null;

    for (let i = 0; i < ids.length; i++) {
        if (Math.round(ids[i] ?? 0) !== wasmId) continue;
        const offset = i * WASM_TRANSFORM_STRIDE;
        if (offset + (WASM_TRANSFORM_STRIDE - 1) >= transforms.length) return null;
        return {
            x: transforms[offset + 0] ?? 0,
            y: transforms[offset + 1] ?? 0,
            z: transforms[offset + 2] ?? 0,
            qx: transforms[offset + 3] ?? 0,
            qy: transforms[offset + 4] ?? 0,
            qz: transforms[offset + 5] ?? 0,
            qw: transforms[offset + 6] ?? 0,
        };
    }

    return null;
}

export function getDieQuaternion(die: SpawnedDie): THREE.Quaternion {
    if (isUsingWasmPhysics() && die?.wasmId != null) {
        const wasmTransform = getWasmTransformForDie(die.wasmId);
        if (wasmTransform) {
            _readQ.set(wasmTransform.qx, wasmTransform.qy, wasmTransform.qz, wasmTransform.qw);
            return _readQ;
        }
    }

    return die.mesh.quaternion;
}
