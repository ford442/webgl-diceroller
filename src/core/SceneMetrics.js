export const ROOM_FLOOR_Y = -12.5;
export const TABLE_SURFACE_Y = 1.0;
export const TABLE_CENTER_Y = TABLE_SURFACE_Y - 0.25;
export const TABLETOP_Y_OFFSET = TABLE_SURFACE_Y - -2.75;
// TavernWalls: floorY(-10) + wallHeight(30) — lamp chain mounts just below ceiling.
export const ROOM_CEILING_Y = 20;
export const LAMP_HANG_Y = ROOM_CEILING_Y - 0.35;
export const CAMERA_EYE_Y = TABLE_SURFACE_Y + 8.75;
export const CAMERA_START_Z = 18;
export const CAMERA_LOOK_AT_Y = TABLE_SURFACE_Y + 0.35;

export function toCurrentTabletopY(position) {
    return {
        ...position,
        y: position.y + TABLETOP_Y_OFFSET
    };
}
