import type { SceneDocument } from './SceneDocument';
import {
    PHYSICS_GRAVITY,
    PHYSICS_TABLE_HALF,
    PHYSICS_TABLE_Y,
} from 'dice-core/wasm/physicsPresets';

const PI = Math.PI;

/**
 * A navigator's chart room: the same velvet table, cup, tower, tray and jail,
 * set in a windowless brick room under one lantern.
 *
 * Deliberately small, and built only from factories the tavern already uses —
 * no new geometry, no forked props. What differs from the tavern is the list:
 * no `TavernWalls` (so no window, fireplace or god-ray beam), no lamp, furniture
 * or flying candles, and a decor pool of charting instruments instead of the
 * pub's pewter. The table is the same 36×36 `Table`, so the physics bounds
 * match it; gravity is the solver's tuned value. Both are `dice-core`'s
 * `PHYSICS_*` constants, the ones `rollHeadless` and seeded throws assume, so a
 * chart-room share link replays the same way in Node.
 *
 * Poses reuse the tavern's slots around the dice zone, which are known to
 * clear the cup, tower, tray and jail.
 */
export const CHART_ROOM_SCENE: SceneDocument = {
    id: 'chart-room',
    label: 'chart room',
    gravity: PHYSICS_GRAVITY,
    table: { y: PHYSICS_TABLE_Y, halfW: PHYSICS_TABLE_HALF, halfD: PHYSICS_TABLE_HALF },
    lighting: 'lantern-dim',
    props: [
        // ── tier 0 ──
        { factory: 'Room', tier: 0, cull: false },
        { factory: 'Table', tier: 0 },
        { factory: 'Clutter', tier: 0 },
        // ── tier 2: the dice furniture, always present ──
        { factory: 'DiceTower', tier: 2, position: { x: 0, y: -3, z: -14 }, rotationY: 0 },
        { factory: 'DiceTray', tier: 2, position: { x: 12, y: -2.75, z: 10 }, rotationY: PI / 6 },
        {
            factory: 'DiceJail',
            tier: 2,
            position: { x: -13, y: -2.75, z: -13 },
            rotationY: -PI / 4,
        },
        { factory: 'DiceCup', tier: 2, position: { x: 5, y: -2.75, z: 2 }, rotationY: -PI / 8 },
        // ── tier 2: instruments, drawn by the layout seed ──
        {
            factory: 'Map',
            tier: 2,
            position: { x: -14, y: -2.75, z: 0 },
            rotationY: PI / 3,
            randomPool: true,
        },
        {
            factory: 'Hourglass',
            tier: 2,
            position: { x: 11, y: -1.75, z: -11 },
            rotationY: PI / 12,
            randomPool: true,
        },
        {
            factory: 'Scroll',
            tier: 2,
            position: { x: 10, y: -2.4, z: 13 },
            rotationY: -PI / 8,
            randomPool: true,
        },
        {
            factory: 'Lantern',
            tier: 2,
            position: { x: -6, y: -2.75, z: -14 },
            rotationY: 0,
            randomPool: true,
        },
        // ── tier 3 ──
        {
            factory: 'Compass',
            tier: 3,
            position: { x: 7, y: -2.65, z: 14 },
            rotationY: PI / 8,
            randomPool: true,
        },
        {
            factory: 'Spyglass',
            tier: 3,
            position: { x: 14, y: -2.75, z: 6 },
            rotationY: -PI / 6,
            randomPool: true,
        },
        {
            factory: 'Astrolabe',
            tier: 3,
            position: { x: 10, y: -2.75, z: -8 },
            rotationY: PI / 4,
            randomPool: true,
        },
        {
            factory: 'Sundial',
            tier: 3,
            position: { x: 8, y: -2.75, z: 8 },
            rotationY: -PI / 6,
            randomPool: true,
        },
        {
            factory: 'Rope',
            tier: 3,
            position: { x: 6, y: -2.75, z: -15 },
            rotationY: PI / 6,
            randomPool: true,
        },
        { factory: 'Quill', tier: 3, randomPool: true },
        { factory: 'Inkwell', tier: 3, randomPool: true },
    ],
};
