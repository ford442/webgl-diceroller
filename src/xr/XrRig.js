import * as THREE from 'three';
import { TABLE_SURFACE_Y, DICE_ZONE_HALF } from '../core/SceneMetrics.js';
import { computeSeatedRecenter, rotateAboutPivot } from './XrRecenter.js';

/**
 * Fantasy scene units → meters for XR.
 * Table width 36 × 0.05 ≈ 1.8 m; velvet zone 16 × 0.05 ≈ 0.8 m (arm reach).
 */
export const XR_WORLD_SCALE = 0.05;

/** Real-world table height (meters) under local-floor reference. */
export const XR_TABLE_HEIGHT_M = 0.75;

/** Extra distance past velvet edge so the player sits at the table rim (scene units). */
export const XR_SEAT_OFFSET_SCENE = 1.5;

/** Seat distance from the table centre, meters. */
export const XR_SEAT_DISTANCE_M = (DICE_ZONE_HALF + XR_SEAT_OFFSET_SCENE) * XR_WORLD_SCALE;

/**
 * Scene children that belong to reference space, not to the tavern: they are
 * never adopted into (and so never scaled with) `xrWorld`.
 * @param {import('three').Object3D} child
 */
export function isReferenceSpaceObject(child) {
    return typeof child.name === 'string' && child.name.startsWith('xr');
}

/**
 * The XR world rig:
 *
 *   scene
 *   └─ xrDolly        reference-space pose of the table (yaw + floor position)
 *      ├─ xrWorld     the tavern, scaled scene units → meters
 *      └─ xrTableAnchor  meters, at the velvet centre on the table surface;
 *                        world-space chrome (results, initiative) hangs here
 *
 * `vr` mode seats the player at the table rim in front of the XR origin;
 * `ar` mode puts the table surface on a placed pose (hit test / anchor).
 * Transforms apply only while presenting; exiting restores identity, so the
 * desktop camera sees the tavern exactly as before.
 *
 * @param {import('three').Scene} scene
 */
export function createXrRig(scene) {
    const dolly = new THREE.Group();
    dolly.name = 'xrDolly';
    scene.add(dolly);

    const xrWorld = new THREE.Group();
    xrWorld.name = 'xrWorld';
    dolly.add(xrWorld);

    const tableAnchor = new THREE.Group();
    tableAnchor.name = 'xrTableAnchor';
    dolly.add(tableAnchor);

    let contentAdopted = false;
    let yawRadians = 0;
    /** @type {'vr' | 'ar'} */
    let mode = 'vr';
    let presenting = false;
    let placed = false;

    /**
     * Move every non-XR scene child under `xrWorld`. `add`, not `attach`: the
     * tavern's local transforms are authored (and, for dice, written by
     * physics every frame) in scene units, which is exactly `xrWorld`'s local
     * space — `attach` would bake the 0.05 scale into a die spawned later.
     * Cheap enough to run every presenting frame, so dice spawned mid-session
     * are picked up too.
     */
    function adoptSceneContent() {
        for (const child of [...scene.children]) {
            if (child === dolly || isReferenceSpaceObject(child)) continue;
            xrWorld.add(child);
        }
        contentAdopted = true;
    }

    function applyDolly() {
        dolly.rotation.y = yawRadians;
    }

    function layoutForMode() {
        xrWorld.scale.setScalar(XR_WORLD_SCALE);
        if (mode === 'ar') {
            // Table surface on the placed pose (dolly origin), centred.
            xrWorld.position.set(0, -TABLE_SURFACE_Y * XR_WORLD_SCALE, 0);
            tableAnchor.position.set(0, 0, 0);
            xrWorld.visible = placed;
            tableAnchor.visible = placed;
        } else {
            // Raise the scaled table surface to a real seated table height and
            // put the velvet centre in front of the XR origin (−Z look).
            xrWorld.position.set(
                0,
                XR_TABLE_HEIGHT_M - TABLE_SURFACE_Y * XR_WORLD_SCALE,
                -XR_SEAT_DISTANCE_M
            );
            tableAnchor.position.set(0, XR_TABLE_HEIGHT_M, -XR_SEAT_DISTANCE_M);
            xrWorld.visible = true;
            tableAnchor.visible = true;
        }
    }

    /**
     * @param {boolean} next
     * @param {{ mode?: 'vr' | 'ar' }} [options]
     */
    function applySeatedCalibration(next, options = {}) {
        presenting = next;
        if (!next) {
            xrWorld.scale.set(1, 1, 1);
            xrWorld.position.set(0, 0, 0);
            xrWorld.visible = true;
            tableAnchor.visible = false;
            dolly.position.set(0, 0, 0);
            yawRadians = 0;
            placed = false;
            applyDolly();
            return;
        }
        if (options.mode) mode = options.mode;
        adoptSceneContent();
        layoutForMode();
        applyDolly();
    }

    /**
     * Snap turn about the player's head (not the reference-space origin), so
     * turning never slides the table sideways past the player.
     * @param {number} deltaDegrees positive = turn right
     * @param {{ x: number, z: number } | null} [pivot] head position
     */
    function snapTurn(deltaDegrees, pivot = null) {
        const delta = -(deltaDegrees * Math.PI) / 180;
        if (pivot) {
            const moved = rotateAboutPivot(
                { x: dolly.position.x, z: dolly.position.z },
                pivot,
                delta
            );
            dolly.position.x = moved.x;
            dolly.position.z = moved.z;
        }
        yawRadians += delta;
        applyDolly();
    }

    /**
     * Seated recenter (VR): table in front of where the head is and faces now.
     * Never touches Y — `local-floor` owns height. Without a head pose this is
     * the old reset (dolly back to the origin).
     * @param {{ position: { x: number, z: number }, quaternion: { x: number, y: number, z: number, w: number } } | null} [head]
     */
    function resetSeat(head = null) {
        if (mode === 'ar') return; // AR re-placement goes through placeAt.
        if (head) {
            const pose = computeSeatedRecenter(head.position, head.quaternion);
            dolly.position.set(pose.x, 0, pose.z);
            yawRadians = pose.yaw;
        } else {
            dolly.position.set(0, 0, 0);
            yawRadians = 0;
        }
        if (presenting) layoutForMode();
        applyDolly();
    }

    /**
     * AR: put the table surface centre on a reference-space pose.
     * @param {{ x: number, y: number, z: number }} position
     * @param {number} yaw
     */
    function placeAt(position, yaw) {
        dolly.position.set(position.x, position.y, position.z);
        yawRadians = yaw;
        placed = true;
        if (presenting) layoutForMode();
        applyDolly();
    }

    /** AR: hide the table again until the next placement. */
    function unplace() {
        placed = false;
        if (presenting) layoutForMode();
    }

    return {
        dolly,
        xrWorld,
        tableAnchor,
        adoptSceneContent,
        applySeatedCalibration,
        snapTurn,
        resetSeat,
        placeAt,
        unplace,
        get mode() {
            return mode;
        },
        get placed() {
            return placed;
        },
        get yawRadians() {
            return yawRadians;
        },
        get contentAdopted() {
            return contentAdopted;
        },
    };
}
