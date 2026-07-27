/**
 * PropPhysics.js
 *
 * The single ammo.js seam for environment props.
 *
 * Dice run entirely on the WASM engine (ammo dice bodies exist only on the
 * `?no-wasm` fallback). Props are the one remaining ammo consumer: their
 * hand-built `bt*Shape` static colliders have no WASM equivalent yet, so this
 * module wraps the two ammo entry points props need and keeps every prop file
 * free of a direct `physics.js` import.
 *
 * When ammo is not loaded — the default WASM session — every call here is a
 * no-op and props become visual-only. Declarative colliders should instead go
 * through `core/StaticColliderBridge.js`, which prefers the WASM backend.
 */

import { createStaticBody, getAmmo, isAmmoAvailable } from '../physics.js';

/** @typedef {import('../types/ammo').AmmoModule} AmmoModule */
/** @typedef {import('../types/ammo').AmmoRigidBody} AmmoRigidBody */
/** @typedef {import('../types/ammo').AmmoWorld} AmmoWorld */

/**
 * The ammo module for building prop collision shapes, or `null` when this
 * session has no ammo (props render without colliders).
 * @returns {AmmoModule | null}
 */
export const getPropAmmo = () => getAmmo();

/** True when prop colliders can be created in this session. */
export const isPropPhysicsAvailable = () => isAmmoAvailable();

/**
 * Add a zero-mass ammo body for a prop, positioned from `mesh`.
 * Returns `null` (and clears `mesh.userData.physicsBody`) when unavailable.
 *
 * @param {AmmoWorld | null | undefined} world
 * @param {import('three').Object3D} mesh
 * @param {unknown} shape
 * @returns {AmmoRigidBody | null}
 */
export const createPropStaticBody = (world, mesh, shape) => createStaticBody(world, mesh, shape);
