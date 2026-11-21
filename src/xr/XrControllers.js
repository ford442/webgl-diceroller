import * as THREE from 'three';
import { getXrSnapDegrees } from './XrFlags.js';
import { createXrGrab } from './XrGrab.js';
import { createXrHands } from './XrHands.js';

const SNAP_COOLDOWN_S = 0.35;
const STICK_THRESHOLD = 0.65;

const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Quaternion();
const _raycaster = new THREE.Raycaster();

/**
 * XR input: controller rays, squeeze / select, tracked-hand pinch, thumbstick
 * snap turn and the seated recenter button.
 *
 * One router decides what a press does, in order:
 *   1. AR and the table is not placed yet → place it on the reticle;
 *   2. the ray points at a world-space chrome button → press it;
 *   3. otherwise grab a die (pinch: the die nearest the fingertips, falling
 *      back to the hand's ray; controller: the die under the ray).
 * Squeeze only ever grabs. A tracked hand's own `select` events are ignored —
 * its pinch arrives through XrHands with a real fingertip position instead.
 *
 * @param {object} options
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {import('three').Scene} options.scene
 * @param {ReturnType<typeof import('./XrRig.js').createXrRig>} options.rig
 * @param {{ onMotionActivityChange?: (active: boolean, reason: 'drag') => void }} [options.hooks]
 * @param {boolean} [options.handsEnabled]
 * @param {() => { position: THREE.Vector3, quaternion: THREE.Quaternion } | null} [options.getHeadPose]
 * @param {() => { pick: (r: THREE.Raycaster) => string | null, press: (id: string) => boolean, setHover: (id: string | null) => void } | null} [options.getChrome]
 * @param {() => { confirm: () => boolean } | null} [options.getPlacement]
 */
export function createXrControllers({
    renderer,
    scene,
    rig,
    hooks = {},
    handsEnabled = true,
    getHeadPose = () => null,
    getChrome = () => null,
    getPlacement = () => null,
}) {
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

    /**
     * @param {THREE.Object3D} controller
     * @returns {string | null}
     */
    function chromeUnderRay(controller) {
        const chrome = getChrome();
        if (!chrome) return null;
        controller.getWorldPosition(_rayOrigin);
        controller.getWorldQuaternion(_rayDir);
        _raycaster.set(_rayOrigin, new THREE.Vector3(0, 0, -1).applyQuaternion(_rayDir));
        _raycaster.far = 3;
        return chrome.pick(_raycaster);
    }

    /**
     * Placement / chrome steps of the router. True when the press was used.
     * @param {THREE.Object3D} controller
     */
    function routeUiPress(controller) {
        if (rig.mode === 'ar' && !rig.placed) {
            return getPlacement()?.confirm() === true;
        }
        const buttonId = chromeUnderRay(controller);
        if (buttonId) return getChrome()?.press(buttonId) === true;
        return false;
    }

    /** @param {{ data?: XRInputSource }} event */
    const fromHand = (event) => event?.data?.hand != null;

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
        controller.addEventListener('squeezestart', (e) => {
            if (fromHand(e)) return;
            grab.tryGrab(index, controller);
        });
        controller.addEventListener('squeezeend', (e) => {
            if (fromHand(e)) return;
            grab.tryRelease(index);
        });
        controller.addEventListener('selectstart', (e) => {
            if (fromHand(e)) return;
            if (routeUiPress(controller)) return;
            grab.tryGrab(index, controller);
        });
        controller.addEventListener('selectend', (e) => {
            if (fromHand(e)) return;
            grab.tryRelease(index);
        });
    }

    const hands = handsEnabled
        ? createXrHands({
              renderer,
              scene,
              onPinchStart: (index, point) => {
                  const controller = controllers[index];
                  if (controller && routeUiPress(controller)) return;
                  if (grab.tryGrabNear(index, point)) return;
                  // Nothing within reach of the fingertips: the hand's
                  // target ray (three poses it like a controller) picks.
                  if (controller) grab.tryGrab(index, controller);
              },
              onPinchEnd: (index) => grab.tryRelease(index),
          })
        : null;

    /** @type {XRInputSource[]} */
    let inputSources = [];
    let snapCooldown = 0;
    /** @type {XRSession | null} */
    let activeSession = null;
    const onInputSourcesChange = () => {
        inputSources = [...(activeSession?.inputSources ?? [])];
    };

    /** @param {XRSession} session */
    function onSessionStart(session) {
        activeSession = session;
        inputSources = [...(session.inputSources ?? [])];
        session.addEventListener('inputsourceschange', onInputSourcesChange);
    }

    function onSessionEnd() {
        grab.releaseAll();
        hands?.reset();
        activeSession?.removeEventListener?.('inputsourceschange', onInputSourcesChange);
        activeSession = null;
        inputSources = [];
        snapCooldown = 0;
        getChrome()?.setHover(null);
    }

    function headPivot() {
        const head = getHeadPose();
        return head ? { x: head.position.x, z: head.position.z } : null;
    }

    /**
     * Thumbstick X → snap turn about the head; A/X button → seated recenter.
     * @param {number} deltaTime
     */
    function updateComfort(deltaTime) {
        if (snapCooldown > 0) snapCooldown -= deltaTime;

        for (const source of inputSources) {
            const gamepad = source.gamepad;
            if (!gamepad || source.hand) continue;

            // Common Quest mapping: axes[2] or axes[0] is thumbstick X.
            const axisX =
                gamepad.axes.length > 2
                    ? gamepad.axes[2]
                    : gamepad.axes.length > 0
                      ? gamepad.axes[0]
                      : 0;

            if (snapCooldown <= 0 && Math.abs(axisX) >= STICK_THRESHOLD) {
                // AR has no snap turn: the table is pinned to the real world.
                if (rig.mode !== 'ar') {
                    rig.snapTurn(axisX > 0 ? snapDegrees : -snapDegrees, headPivot());
                }
                snapCooldown = SNAP_COOLDOWN_S;
            }

            // buttons[4] / buttons[5] often map to X/A on Quest — use as recenter.
            const recenter =
                gamepad.buttons[4]?.pressed === true || gamepad.buttons[5]?.pressed === true;
            if (recenter && snapCooldown <= 0) {
                if (rig.mode !== 'ar') rig.resetSeat(getHeadPose());
                snapCooldown = SNAP_COOLDOWN_S;
            }
        }
    }

    function updateHover() {
        const chrome = getChrome();
        if (!chrome) return;
        /** @type {string | null} */
        let hovered = null;
        for (const controller of controllers) {
            if (!controller.visible) continue;
            hovered = chromeUnderRay(controller);
            if (hovered) break;
        }
        chrome.setHover(hovered);
    }

    /**
     * @param {number} deltaTime
     */
    function update(deltaTime) {
        if (!renderer.xr.isPresenting) return;
        updateComfort(deltaTime);
        hands?.update();
        updateHover();
        grab.update(
            deltaTime,
            controllers,
            (index, out) => hands?.getPinchPoint(index, out) ?? false
        );
    }

    function dispose() {
        grab.releaseAll();
        for (const c of controllers) scene.remove(c);
        for (const g of grips) scene.remove(g);
        hands?.dispose();
        rayGeo.dispose();
        rayMat.dispose();
    }

    return {
        controllers,
        grab,
        hands,
        onSessionStart,
        onSessionEnd,
        update,
        dispose,
    };
}
