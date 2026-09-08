/**
 * Shared mutable runtime state for dynamic (movable) props — the "knockable
 * clutter" bodies registered via a `dynamic: true` collider spec (propKit.js
 * / StaticColliderBridge.js). Mirrors dice/DiceState.js's spawnedDice list,
 * but a dynamic prop's identity is its THREE.Group root (`userData.wasmDynamicIds`
 * / `userData.physicsBody` carry the physics-side handle), not a die record.
 */

/** @type {import('three').Object3D[]} */
export let spawnedProps = [];

export function registerDynamicProp(group) {
    if (group && !spawnedProps.includes(group)) spawnedProps.push(group);
}

export function unregisterDynamicProp(group) {
    const i = spawnedProps.indexOf(group);
    if (i >= 0) spawnedProps.splice(i, 1);
}

export function clearSpawnedProps() {
    spawnedProps = [];
}
