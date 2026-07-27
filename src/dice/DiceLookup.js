import { spawnedDice } from './DiceState.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';

/** @typedef {import('../types/dice').SpawnedDie} SpawnedDie */
/** @typedef {import('../types/physics').CollisionEvent} CollisionEvent */

/**
 * @param {import('three').Mesh | null | undefined} mesh
 * @returns {SpawnedDie | null}
 */
export const findSpawnedDieByMesh = (mesh) => spawnedDice.find((die) => die.mesh === mesh) || null;

/**
 * Map a physics collision id (WASM die id or ammo audioBodyId) back to a spawned die.
 * @param {number} id
 * @returns {SpawnedDie | null}
 */
export const findSpawnedDieByPhysicsId = (id) => {
    if (id < 0) return null;
    const useWasmIds = isUsingWasmPhysics();
    for (const die of spawnedDice) {
        if (useWasmIds && die.wasmId === id) return die;
        if (!useWasmIds && die.audioBodyId === id) return die;
        if (die.wasmId === id || die.audioBodyId === id) return die;
    }
    return null;
};

import * as THREE from 'three';

const _audioPos = new THREE.Vector3();

/** Attach world position, die sides, and surface hints for spatial audio routing. */
/**
 * @param {CollisionEvent & { surface?: string; otherSurface?: string; position?: { x: number; y: number; z: number }; sides?: number }} event
 */
export function enrichCollisionEventForAudio(event) {
    const die =
        findSpawnedDieByPhysicsId(event.idA) ??
        (event.idB >= 0 ? findSpawnedDieByPhysicsId(event.idB) : null);
    const otherSurface =
        event.idB === -1
            ? 'velvet'
            : (event.otherSurface ?? (event.idB <= -100 ? 'leather' : 'die'));
    if (!die?.mesh) {
        return { ...event, otherSurface };
    }
    die.mesh.getWorldPosition(_audioPos);
    return {
        ...event,
        position: { x: _audioPos.x, y: _audioPos.y, z: _audioPos.z },
        sides: Number.parseInt(die.type.replace('d', ''), 10) || 6,
        surface: event.surface ?? 'die',
        otherSurface,
    };
}
