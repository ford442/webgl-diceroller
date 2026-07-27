import * as THREE from 'three';
import { getXrSnapDegrees } from './XrFlags.js';
import { createXrGrab } from './XrGrab.js';

const SNAP_COOLDOWN_S = 0.35;
const STICK_THRESHOLD = 0.65;

/**
 * @param {object} options
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {import('three').Scene} options.scene
 * @param {ReturnType<typeof import('./XrRig.js').createXrRig>} options.rig
 * @param {{ onMotionActivityChange?: (active: boolean, reason: 'drag') => void }} [options.hooks]
 */
export function createXrControllers({ renderer, scene, rig, hooks = {} }) {
    const snapDegrees = getXrSnapDegrees();
    const grab = createXrGrab({
        getContentRoot: () => rig.xrWorld,
        hooks,
    });

    /** @type {import('three').XRTargetRaySpace[]} */
    const controllers = [];
    /** @type {import('three').XRGripSpace[]} */
    const grips = [];
    /** @type {import('three').Line[]} */
    const rays = [];

    const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1.2),
    ]);
    const rayMat = new THREE.LineBasicMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.7,
    });

    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        controller.name = `xrController${i}`;
        scene.add(controller);
        controllers.push(controller);

        const ray = new THREE.Line(rayGeo, rayMat);
        ray.scale.z = 1;
        controller.add(ray);
        rays.push(ray);

        const grip = renderer.xr.getControllerGrip(i);
        grip.name = `xrGrip${i}`;
        scene.add(grip);
        grips.push(grip);

        const index = i;
        controller.addEventListener('squeezestart', () => grab.tryGrab(index, controller));
        controller.addEventListener('squeezeend', () => grab.tryRelease(index));
        controller.addEventListener('selectstart', () => grab.tryGrab(index, controller));
        controller.addEventListener('selectend', () => grab.tryRelease(index));
    }

    /** @type {XRInputSource[]} */
    let inputSources = [];
    let snapCooldown = 0;

    function onSessionStart(session) {
        inputSources = [...(session.inputSources ?? [])];
        session.addEventListener('inputsourceschange', () => {
            inputSources = [...(session.inputSources ?? [])];
        });
    }

    function onSessionEnd() {
        grab.releaseAll();
        inputSources = [];
        snapCooldown = 0;
    }

    /**
     * Thumbstick X → snap turn; A/X button → reset seat (when available).
     * @param {number} deltaTime
     */
    function updateComfort(deltaTime) {
        if (snapCooldown > 0) snapCooldown -= deltaTime;

        for (const source of inputSources) {
            const gamepad = source.gamepad;
            if (!gamepad) continue;

            // Common Quest mapping: axes[2] or axes[0] is thumbstick X.
            const axisX =
                gamepad.axes.length > 2
                    ? gamepad.axes[2]
                    : gamepad.axes.length > 0
                      ? gamepad.axes[0]
                      : 0;

            if (snapCooldown <= 0 && Math.abs(axisX) >= STICK_THRESHOLD) {
                rig.snapTurn(axisX > 0 ? snapDegrees : -snapDegrees);
                snapCooldown = SNAP_COOLDOWN_S;
            }

            // buttons[4] / buttons[5] often map to X/A on Quest — use as recenter.
            const recenter =
                gamepad.buttons[4]?.pressed === true || gamepad.buttons[5]?.pressed === true;
            if (recenter && snapCooldown <= 0) {
                rig.resetSeat();
                snapCooldown = SNAP_COOLDOWN_S;
            }
        }
    }

    /**
     * @param {number} deltaTime
     */
    function update(deltaTime) {
        if (!renderer.xr.isPresenting) return;
        updateComfort(deltaTime);
        grab.update(deltaTime, controllers);
    }

    function dispose() {
        grab.releaseAll();
        for (const c of controllers) scene.remove(c);
        for (const g of grips) scene.remove(g);
        rayGeo.dispose();
        rayMat.dispose();
    }

    return {
        controllers,
        grab,
        onSessionStart,
        onSessionEnd,
        update,
        dispose,
    };
}
