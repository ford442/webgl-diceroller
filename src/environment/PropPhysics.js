/**
 * PropPhysics.js
 *
 * Internal ammo.js implementation seam for StaticColliderBridge.
 * Prop modules must not import this file — use createProp + declarative
 * colliders from propKit.js instead.
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
