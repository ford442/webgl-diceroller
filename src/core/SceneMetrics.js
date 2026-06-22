export const ROOM_FLOOR_Y = -12.5;
export const ROOM_CENTER_Y = 5;
export const ROOM_HEIGHT = 35;
export const ROOM_CEILING_Y = ROOM_CENTER_Y + ROOM_HEIGHT / 2;
export const TABLE_SURFACE_Y = 1.0;
export const TABLE_CENTER_Y = TABLE_SURFACE_Y - 0.25;
export const TABLETOP_Y_OFFSET = TABLE_SURFACE_Y - -2.75;
// Chain mount sits just below the ceiling; shades hang in negative local Y.
export const LAMP_HANG_Y = ROOM_CEILING_Y - 1.5;
export const CAMERA_EYE_Y = TABLE_SURFACE_Y + 8.75;
export const CAMERA_START_Z = 18;
export const CAMERA_LOOK_AT_Y = TABLE_SURFACE_Y + 0.35;

export function toCurrentTabletopY(position) {
    return {
        ...position,
        y: position.y + TABLETOP_Y_OFFSET
    };
}
