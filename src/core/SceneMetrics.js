export const ROOM_FLOOR_Y = -12.5;
export const TABLE_SURFACE_Y = 1.0;
export const TABLE_CENTER_Y = TABLE_SURFACE_Y - 0.25;
export const TABLETOP_Y_OFFSET = TABLE_SURFACE_Y - -2.75;
// Scaled billiard lamp is ~30 units tall; the chain anchor must sit well above the
// ceiling (y≈20) so the shades hang over the table instead of through the floor.
export const LAMP_MODEL_DROP_Y = 30;
export const LAMP_HANG_Y = TABLE_SURFACE_Y + LAMP_MODEL_DROP_Y + 7; // shades ≈ y 8–14
export const CAMERA_EYE_Y = TABLE_SURFACE_Y + 8.75;
export const CAMERA_START_Z = 18;
export const CAMERA_LOOK_AT_Y = TABLE_SURFACE_Y + 0.35;

export function toCurrentTabletopY(position) {
    return {
        ...position,
        y: position.y + TABLETOP_Y_OFFSET
    };
}
