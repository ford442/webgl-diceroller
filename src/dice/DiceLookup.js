import { spawnedDice } from './DiceState.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';
import { findSpawnedPropByPhysicsId } from '../environment/DynamicPropSync.js';

// Must match DicePhysicsEngine::DYNAMIC_EVENT_ID_BASE (dice_physics_engine.hpp) —
// dynamic-prop collision-event ids are encoded as `DYNAMIC_EVENT_ID_BASE - userId`,
// well clear of the static-collider encoding (`STATIC_EVENT_ID_BASE - userId`,
// STATIC_EVENT_ID_BASE = -2000) so the two never collide.
const DYNAMIC_EVENT_ID_BASE = -1000000;

/** Decode a dynamic-prop collision-event id back to its userId, or null. */
function dynamicPropUserId(id) {
    return id <= DYNAMIC_EVENT_ID_BASE ? DYNAMIC_EVENT_ID_BASE - id : null;
}

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
    if (die?.mesh) {
        die.mesh.getWorldPosition(_audioPos);
        return {
            ...event,
            position: { x: _audioPos.x, y: _audioPos.y, z: _audioPos.z },
            sides: Number.parseInt(die.type.replace('d', ''), 10) || 6,
            surface: event.surface ?? 'die',
            otherSurface,
        };
    }

    // Neither side was a die (e.g. a dynamic prop settling against a static
    // collider or another prop) — try a prop position for spatial audio.
    const propGroup =
        findSpawnedPropByPhysicsId(dynamicPropUserId(event.idA)) ??
        findSpawnedPropByPhysicsId(dynamicPropUserId(event.idB));
    if (!propGroup) {
        return { ...event, otherSurface };
    }
    propGroup.getWorldPosition(_audioPos);
    return {
        ...event,
        position: { x: _audioPos.x, y: _audioPos.y, z: _audioPos.z },
        otherSurface,
    };
}
