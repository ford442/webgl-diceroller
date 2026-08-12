// Vertical scale is tuned for a ~36u-wide gaming table (~1.1 m). Ratios target a
// standard 30" (0.76 m) playing height, ~9 ft (2.7 m) ceiling, and a standing
// sightline ~30" above the felt (not a bird's-eye drone shot).
export const ROOM_FLOOR_Y = -10;
export const TABLE_SURFACE_Y = 1.0;
export const TABLE_CENTER_Y = TABLE_SURFACE_Y - 0.25;
export const TABLETOP_Y_OFFSET = TABLE_SURFACE_Y - -2.75;
// Floor mesh top ≈ ROOM_FLOOR_Y + 0.5; table top is TABLE_SURFACE_Y (11u above floor).
export const TABLE_HEIGHT_ABOVE_FLOOR = TABLE_SURFACE_Y - (ROOM_FLOOR_Y + 0.5);
// Scaled billiard lamp is ~30 units tall; the chain anchor must sit well above the
// ceiling so the shades hang over the table instead of through the floor.
export const LAMP_MODEL_DROP_Y = 30;
export const ROOM_CEILING_Y = 22;
export const ROOM_WALL_HEIGHT = ROOM_CEILING_Y - ROOM_FLOOR_Y;
export const LAMP_HANG_Y = TABLE_SURFACE_Y + LAMP_MODEL_DROP_Y + 7; // shades ≈ y 8–14
// Default orbit camera: standing player ~1 step back from a 36u table edge.
export const CAMERA_EYE_Y = TABLE_SURFACE_Y + 7.5;
export const CAMERA_START_Z = 18;
export const CAMERA_LOOK_AT_Y = TABLE_SURFACE_Y + 0.25;
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
        Math.abs(camera.position.x) < 0.01 &&
        Math.abs(camera.position.y - CAMERA_EYE_Y) < 0.5 &&
        Math.abs(camera.position.z - CAMERA_START_Z) < 2.5;

    if (nearDefaultPose) {
        camera.position.z = targetZ;
        camera.lookAt(0, CAMERA_LOOK_AT_Y, 0);
    }

    return { aspect, startZ: targetZ };
}

export function toCurrentTabletopY(position) {
    return {
        ...position,
        y: position.y + TABLETOP_Y_OFFSET,
    };
}
