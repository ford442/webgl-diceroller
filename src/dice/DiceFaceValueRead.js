import { getWasmEngine } from '../wasm/PhysicsBridge.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';

/**
 * Read the engine-authoritative settled face value for a die (0 while moving).
 * @param {number} wasmId
 * @returns {number}
 */
export function getWasmFaceValueForDie(wasmId) {
    if (!isUsingWasmPhysics()) return 0;

    const engine = getWasmEngine();
    if (typeof engine.getDieFaceValue === 'function') {
        return engine.getDieFaceValue(wasmId) | 0;
    }

    if (typeof engine.getFaceValues === 'function' && typeof engine.getDieIds === 'function') {
        const values = engine.getFaceValues();
        const ids = engine.getDieIds();
        for (let i = 0; i < ids.length; i++) {
            if (Math.round(ids[i]) === wasmId) {
                return values[i] | 0;
            }
        }
    }

    return 0;
}
