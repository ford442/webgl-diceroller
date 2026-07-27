import * as THREE from 'three';
import { TABLE_SURFACE_Y, DICE_ZONE_HALF } from '../core/SceneMetrics.js';

/**
 * Fantasy scene units → meters for seated XR.
 * Table width 36 × 0.05 ≈ 1.8 m; velvet zone 16 × 0.05 ≈ 0.8 m (arm reach).
 */
export const XR_WORLD_SCALE = 0.05;

/** Real-world table height (meters) under local-floor reference. */
export const XR_TABLE_HEIGHT_M = 0.75;

/** Extra distance past velvet edge so the player sits at the table rim (scene units). */
export const XR_SEAT_OFFSET_SCENE = 1.5;

/**
 * Create the XR world group + yaw dolly for snap-turn.
 * Content is adopted into `xrWorld` after tier load; transforms apply only while presenting.
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

    let contentAdopted = false;
    let yawRadians = 0;

    function adoptSceneContent() {
        if (contentAdopted) return;
        const children = [...scene.children];
        for (const child of children) {
            if (child === dolly) continue;
            // Keep XR controllers/grips in reference space (not scaled with the tavern).
            if (
                typeof child.name === 'string' &&
                (child.name.startsWith('xrController') || child.name.startsWith('xrGrip'))
            ) {
                continue;
            }
            xrWorld.attach(child);
        }
        contentAdopted = true;
    }

    function applySeatedCalibration(presenting) {
        if (!presenting) {
            xrWorld.scale.set(1, 1, 1);
            xrWorld.position.set(0, 0, 0);
            yawRadians = 0;
            dolly.rotation.y = 0;
            return;
        }

        adoptSceneContent();
        xrWorld.scale.setScalar(XR_WORLD_SCALE);
        // Raise the scaled table surface to a real seated table height.
        xrWorld.position.y = XR_TABLE_HEIGHT_M - TABLE_SURFACE_Y * XR_WORLD_SCALE;
        // Shift world so table center sits in front of the XR origin (-Z look).
        const seatDistanceScene = DICE_ZONE_HALF + XR_SEAT_OFFSET_SCENE;
        xrWorld.position.z = -seatDistanceScene * XR_WORLD_SCALE;
        xrWorld.position.x = 0;
        dolly.rotation.y = yawRadians;
    }

    /**
     * @param {number} deltaDegrees positive = turn right
     */
    function snapTurn(deltaDegrees) {
        yawRadians -= (deltaDegrees * Math.PI) / 180;
        dolly.rotation.y = yawRadians;
    }

    function resetSeat() {
        yawRadians = 0;
        dolly.rotation.y = 0;
        applySeatedCalibration(true);
    }

    return {
        dolly,
        xrWorld,
        adoptSceneContent,
        applySeatedCalibration,
        snapTurn,
        resetSeat,
        get yawRadians() {
            return yawRadians;
        },
        get contentAdopted() {
            return contentAdopted;
        },
    };
}
