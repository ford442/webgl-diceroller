import * as THREE from 'three';
import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { getAmmoDiceBackend } from './DiceState.js';
import { isUsingWasmPhysics } from './diceAmmoFlags.js';

export const WASM_TRANSFORM_STRIDE = 7;

const _readQ = new THREE.Quaternion();

export function getWasmTransformForDie(wasmId) {
    const engine = getWasmEngine();
    if (typeof engine.getDieIds !== 'function') return null;

    const transforms = engine.getTransforms();
    const ids = engine.getDieIds();
    if (!transforms?.length || !ids?.length) return null;

    for (let i = 0; i < ids.length; i++) {
        if (Math.round(ids[i]) !== wasmId) continue;
        const offset = i * WASM_TRANSFORM_STRIDE;
        if (offset + (WASM_TRANSFORM_STRIDE - 1) >= transforms.length) return null;
        return {
            x: transforms[offset + 0],
            y: transforms[offset + 1],
            z: transforms[offset + 2],
            qx: transforms[offset + 3],
            qy: transforms[offset + 4],
            qz: transforms[offset + 5],
            qw: transforms[offset + 6],
        };
    }

    return null;
}

export function getDieQuaternion(die) {
    if (!isUsingWasmPhysics() && die?.body) {
        const transform = getAmmoDiceBackend()?.getAmmoTransform(die);
        if (transform) {
            const rotation = transform.getRotation();
            _readQ.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
            return _readQ;
        }
    }

    if (isUsingWasmPhysics() && die?.wasmId != null) {
        const wasmTransform = getWasmTransformForDie(die.wasmId);
        if (wasmTransform) {
            _readQ.set(wasmTransform.qx, wasmTransform.qy, wasmTransform.qz, wasmTransform.qw);
            return _readQ;
        }
    }

    return die.mesh.quaternion;
}
