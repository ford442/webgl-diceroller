import * as THREE from 'three';
import { findSpawnedPropByPhysicsId } from '../environment/DynamicPropSync.js';
import type { SpawnedDie } from '../types/dice.js';
import type { CollisionEvent } from '../types/physics.js';
import { spawnedDice } from './DiceState.js';
import { isUsingWasmPhysics } from './DicePhysicsPresets.js';

// Must match DicePhysicsEngine::DYNAMIC_EVENT_ID_BASE (dice_physics_engine.hpp) —
// dynamic-prop collision-event ids are encoded as `DYNAMIC_EVENT_ID_BASE - userId`,
// well clear of the static-collider encoding (`STATIC_EVENT_ID_BASE - userId`,
// STATIC_EVENT_ID_BASE = -2000) so the two never collide.
const DYNAMIC_EVENT_ID_BASE = -1000000;

/** Decode a dynamic-prop collision-event id back to its userId, or null. */
function dynamicPropUserId(id: number): number | null {
    return id <= DYNAMIC_EVENT_ID_BASE ? DYNAMIC_EVENT_ID_BASE - id : null;
}

export const findSpawnedDieByMesh = (mesh: THREE.Object3D | null | undefined): SpawnedDie | null =>
    spawnedDice.find((die) => die.mesh === mesh) || null;

/**
 * Map a physics collision id (WASM die id, or legacy audioBodyId) back to a spawned die.
 */
export const findSpawnedDieByPhysicsId = (id: number): SpawnedDie | null => {
    if (id < 0) return null;
    const useWasmIds = isUsingWasmPhysics();
    for (const die of spawnedDice) {
        if (useWasmIds && die.wasmId === id) return die;
        if (!useWasmIds && die.audioBodyId === id) return die;
        if (die.wasmId === id || die.audioBodyId === id) return die;
    }
    return null;
};

const _audioPos = new THREE.Vector3();

export type EnrichedCollisionEvent = CollisionEvent & {
    surface?: string;
    otherSurface?: string;
    position?: { x: number; y: number; z: number };
    sides?: number;
};

/** Attach world position, die sides, and surface hints for spatial audio routing. */
export function enrichCollisionEventForAudio(
    event: EnrichedCollisionEvent
): EnrichedCollisionEvent {
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

    const aProp = dynamicPropUserId(event.idA);
    const bProp = dynamicPropUserId(event.idB);
    const propGroup =
        findSpawnedPropByPhysicsId(aProp ?? -1) ?? findSpawnedPropByPhysicsId(bProp ?? -1);
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
