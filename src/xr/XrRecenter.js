/**
 * Pure yaw / pivot math for the XR dolly. Plain `{ x, z }` and quaternion
 * objects (no three import) so the unit test needs no scene.
 *
 * Conventions match three's `Object3D.rotation.y`: a yaw θ maps local
 * (x, z) to (x·cosθ + z·sinθ, −x·sinθ + z·cosθ), so local −Z (the seated
 * player's forward) points along (−sinθ, −cosθ) and local +Z along (sinθ, cosθ).
 */

/**
 * Heading of a pose's forward (−Z) vector projected on the floor, as a dolly
 * yaw: a dolly at this yaw faces where the head faces.
 * @param {{ x: number, y: number, z: number, w: number }} q
 * @returns {number}
 */
export function yawFromQuaternion(q) {
    // forward = q · (0, 0, −1) · q⁻¹, only x and z needed.
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    if (Math.abs(fx) < 1e-9 && Math.abs(fz) < 1e-9) return 0; // looking straight down/up
    return Math.atan2(-fx, -fz);
}

/**
 * Rotate a floor point about a pivot by `delta` radians (three's yaw sense).
 * @param {{ x: number, z: number }} point
 * @param {{ x: number, z: number }} pivot
 * @param {number} delta
 * @returns {{ x: number, z: number }}
 */
export function rotateAboutPivot(point, pivot, delta) {
    const dx = point.x - pivot.x;
    const dz = point.z - pivot.z;
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    return { x: pivot.x + dx * c + dz * s, z: pivot.z - dx * s + dz * c };
}

/**
 * Seated recenter: put the dolly under the head, turned to the head's heading,
 * so the table (authored in front of the dolly's −Z) is in front of where the
 * player is looking now. Height is left alone — `local-floor` owns Y, and
 * recentering never moves the table up or down.
 * @param {{ x: number, z: number }} headPosition
 * @param {{ x: number, y: number, z: number, w: number }} headQuaternion
 * @returns {{ x: number, z: number, yaw: number }}
 */
export function computeSeatedRecenter(headPosition, headQuaternion) {
    return { x: headPosition.x, z: headPosition.z, yaw: yawFromQuaternion(headQuaternion) };
}

/**
 * AR placement yaw: turn the table so its seat edge (local +Z) faces the
 * player standing at `viewer`.
 * @param {{ x: number, z: number }} tableCenter
 * @param {{ x: number, z: number }} viewer
 * @returns {number}
 */
export function facingYaw(tableCenter, viewer) {
    const dx = viewer.x - tableCenter.x;
    const dz = viewer.z - tableCenter.z;
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
    return Math.atan2(dx, dz);
}
