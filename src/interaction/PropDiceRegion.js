import * as THREE from 'three';
import { spawnedDice } from '../dice.js';

const _inverse = new THREE.Matrix4();
const _local = new THREE.Vector3();

/**
 * Finds spawned dice whose world position falls inside a prop's local-space
 * box (e.g. a tray floor or a jail interior). Mirrors the world<->local
 * transform DiceCupController uses for its container planes, just applied to
 * point containment instead of plane math.
 *
 * @param {THREE.Group} group
 * @param {{ halfExtents: { x: number, y: number, z: number }, center?: { x?: number, y?: number, z?: number } }} box
 * @returns {import('../types/dice').SpawnedDie[]}
 */
export function findDiceInLocalBox(group, { halfExtents, center = {} }) {
    group.updateMatrixWorld(true);
    _inverse.copy(group.matrixWorld).invert();
    const cx = center.x ?? 0;
    const cy = center.y ?? 0;
    const cz = center.z ?? 0;

    return spawnedDice.filter((die) => {
        if (die.wasmId == null) return false;
        _local.copy(die.mesh.position).applyMatrix4(_inverse);
        return (
            Math.abs(_local.x - cx) <= halfExtents.x &&
            Math.abs(_local.y - cy) <= halfExtents.y &&
            Math.abs(_local.z - cz) <= halfExtents.z
        );
    });
}
