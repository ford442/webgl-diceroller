export const ROOM_FLOOR_Y = -12.5;
export const TABLE_SURFACE_Y = 1.0;
export const TABLE_CENTER_Y = TABLE_SURFACE_Y - 0.25;
export const TABLETOP_Y_OFFSET = TABLE_SURFACE_Y - -2.75;
// Scaled billiard lamp is ~30 units tall; the chain anchor must sit well above the
// ceiling (y≈20) so the shades hang over the table instead of through the floor.
export const LAMP_MODEL_DROP_Y = 30;
export const LAMP_HANG_Y = TABLE_SURFACE_Y + LAMP_MODEL_DROP_Y + 7; // shades ≈ y 8–14
// TavernWalls: floorY(-10) + wallHeight(30) — lamp chain mounts just below ceiling.
export const ROOM_CEILING_Y = 20;
export const CAMERA_EYE_Y = TABLE_SURFACE_Y + 8.75;
export const CAMERA_START_Z = 18;
export const CAMERA_LOOK_AT_Y = TABLE_SURFACE_Y + 0.35;
/** Half-width of the velvet dice zone (Table.js diceZoneSize / 2). */
export const DICE_ZONE_HALF = 8;

/**
 * Pull the default camera back on portrait viewports so the dice zone stays in frame.
 * Narrower horizontal FOV needs more distance for the same table width.
 */
export function computeCameraStartZ(aspect) {
    if (!Number.isFinite(aspect) || aspect <= 0) return CAMERA_START_Z;
    return aspect < 1 ? CAMERA_START_Z / aspect : CAMERA_START_Z;
}

export function computeCameraAspect(width, height) {
    const h = Math.max(height, 1);
    return width / h;
}

/**
 * Update camera projection and default tabletop framing for the current container size.
 */
export function applyViewportToCamera(camera, width, height, { reframe = true } = {}) {
    const aspect = computeCameraAspect(width, height);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    if (!reframe) return { aspect, startZ: computeCameraStartZ(aspect) };

    const targetZ = computeCameraStartZ(aspect);
    const nearDefaultPose =
        Math.abs(camera.position.x) < 0.01
        && Math.abs(camera.position.y - CAMERA_EYE_Y) < 0.5
        && Math.abs(camera.position.z - CAMERA_START_Z) < 2.5;

    if (nearDefaultPose) {
        camera.position.z = targetZ;
        camera.lookAt(0, CAMERA_LOOK_AT_Y, 0);
    }

    return { aspect, startZ: targetZ };
}

export function toCurrentTabletopY(position) {
    return {
        ...position,
        y: position.y + TABLETOP_Y_OFFSET
    };
}
