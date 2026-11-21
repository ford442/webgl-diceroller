/**
 * Passthrough dressing for `immersive-ar`: the room (walls, floor, shelves,
 * the ceiling lamp, rugs) is hidden so only the table, what sits on it, the
 * dice and the lights show over the real world; the opaque backdrop and fog
 * are dropped and the clear goes transparent. Everything is restored on exit.
 *
 * The keep/hide decision is geometric (bounding box vs the table footprint),
 * not a list of prop names, so a scene document that adds a prop never needs
 * an AR entry: anything that reaches the floor, floats above the table (the
 * hanging lamp, floating candles), or extends past the table edge is room.
 * Height alone is not: the dice tower stands tall on the table and stays.
 */

import * as THREE from 'three';
import { TABLE_SURFACE_Y } from '../core/SceneMetrics.js';

/** Half-width of the 36×36 table top (Table.js), scene units. */
export const AR_TABLE_HALF = 18;
const FOOTPRINT_MARGIN = 3;
const BELOW_SURFACE = 1.5;
/** A box whose bottom is this far above the felt is hanging / floating, not resting. */
const FLOATING_ABOVE = 4;

/**
 * @typedef {{
 *   name?: string,
 *   isLight?: boolean,
 *   isDie?: boolean,
 *   factory?: string | null,
 *   box?: { min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number } } | null,
 * }} ArCandidate
 */

/**
 * Whether a top-level tavern object stays visible in AR. Pure.
 * @param {ArCandidate} c
 * @returns {boolean}
 */
export function keepInAr(c) {
    if (c.isLight || c.isDie) return true;
    if (typeof c.name === 'string' && c.name.startsWith('xr')) return true;
    if (c.factory === 'Table' || c.name === 'Table') return true;
    const box = c.box;
    if (!box || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return true;
    const reach = Math.max(
        Math.abs(box.min.x),
        Math.abs(box.max.x),
        Math.abs(box.min.z),
        Math.abs(box.max.z)
    );
    if (reach > AR_TABLE_HALF + FOOTPRINT_MARGIN) return false;
    if (box.min.y < TABLE_SURFACE_Y - BELOW_SURFACE) return false;
    if (box.min.y > TABLE_SURFACE_Y + FLOATING_ABOVE) return false;
    return true;
}

/**
 * @param {object} options
 * @param {import('three').Scene} options.scene
 * @param {{ getClearAlpha?: () => number, setClearAlpha?: (a: number) => void }} options.renderer
 * @param {import('three').Object3D} options.xrWorld
 * @param {(obj: import('three').Object3D) => boolean} [options.isDie]
 */
export function createXrArScene({ scene, renderer, xrWorld, isDie = defaultIsDie }) {
    /** @type {import('three').Object3D[]} */
    let hidden = [];
    /** @type {{ background: any, fog: any, clearAlpha: number } | null} */
    let saved = null;
    const fill = new THREE.HemisphereLight(0xfff4e0, 0x403020, 1.2);
    fill.name = 'xrArFill';
    const box = new THREE.Box3();

    /**
     * Call with `xrWorld` still at identity (before the AR calibration), so
     * world-space boxes are scene-unit boxes.
     */
    function enter() {
        if (saved) return;
        saved = {
            background: scene.background,
            fog: scene.fog,
            clearAlpha: renderer.getClearAlpha?.() ?? 1,
        };
        scene.background = null;
        scene.fog = null;
        renderer.setClearAlpha?.(0);
        scene.add(fill);

        hidden = [];
        for (const child of xrWorld.children) {
            if (!child.visible) continue;
            const isLight = /** @type {any} */ (child).isLight === true;
            box.makeEmpty();
            if (!isLight) box.setFromObject(child);
            const keep = keepInAr({
                name: child.name,
                isLight,
                isDie: isDie(child),
                factory: child.userData?.sceneFactory ?? null,
                box: box.isEmpty() ? null : box,
            });
            if (!keep) {
                child.visible = false;
                hidden.push(child);
            }
        }
    }

    function exit() {
        if (!saved) return;
        for (const child of hidden) child.visible = true;
        hidden = [];
        scene.background = saved.background;
        scene.fog = saved.fog;
        renderer.setClearAlpha?.(saved.clearAlpha);
        scene.remove(fill);
        saved = null;
    }

    return {
        enter,
        exit,
        get hiddenCount() {
            return hidden.length;
        },
        /** Names hidden for passthrough (test hook / debugging). */
        hiddenNames: () => hidden.map((o) => o.name || o.type),
    };
}

/** @param {import('three').Object3D} obj */
function defaultIsDie(obj) {
    return obj.userData?.isDie === true || obj.userData?.body != null;
}
