import * as THREE from 'three';
import { createXrRig } from './XrRig.js';
import { createXrControllers } from './XrControllers.js';
import { createXrUi } from './XrUi.js';
import { getXrSessionMode, isXrHandsEnabled, isXrWebGpuRequested } from './XrFlags.js';
import { buildXrSessionInit } from './XrSessionOptions.js';
import { createXrFramebufferScaleMonitor } from './XrFramebufferScale.js';
import { createXrArScene } from './XrArScene.js';
import { createXrArPlacement } from './XrArPlacement.js';

const _headPos = new THREE.Vector3();
const _headQuat = new THREE.Quaternion();

/**
 * Boot WebXR for the table. Call only when `isXrRequested()`.
 *
 * `?xr` seats the player at the table in `immersive-vr`; `?ar` places the
 * table on a hit-tested surface in `immersive-ar`. Both use the classic
 * `WebGLRenderer.xr`; `?xr-webgpu` (experimental) hands a `WebGPURenderer`'s
 * `renderer.xr` over instead and reports why it refuses to present.
 *
 * @param {object} options
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {import('three').Scene} options.scene
 * @param {import('three').PerspectiveCamera} options.camera
 * @param {{ onMotionActivityChange?: (active: boolean, reason: 'drag') => void }} [options.hooks]
 * @param {(presenting: boolean) => void} [options.onPresentingChange]
 * @param {() => ({ pick: (r: THREE.Raycaster) => string | null, press: (id: string) => boolean, setHover: (id: string | null) => void } | null)} [options.getChrome]
 * @param {URLSearchParams} [options.searchParams]
 * @param {object} [options.qualityProfile] defaults to `QUALITY_PROFILES.xr`
 */
export async function initXrSession({
    renderer,
    scene,
    camera: _camera,
    hooks = {},
    onPresentingChange,
    getChrome = () => null,
    searchParams = new URLSearchParams(window.location.search),
    qualityProfile,
}) {
    if (!renderer.xr) {
        console.warn('[XR] renderer.xr unavailable — WebGLRenderer required.');
        return null;
    }

    const mode = getXrSessionMode(searchParams);
    const handsEnabled = isXrHandsEnabled(searchParams);
    const webgpuExperiment = isXrWebGpuRequested(searchParams);

    renderer.xr.enabled = true;

    const rig = createXrRig(scene);
    const framebuffer = createXrFramebufferScaleMonitor(qualityProfile);

    /** Head pose in reference space (three's XR ArrayCamera), or null. */
    function getHeadPose() {
        if (!renderer.xr.isPresenting) return null;
        const xrCamera = /** @type {any} */ (renderer.xr).getCamera?.();
        if (!xrCamera) return null;
        xrCamera.getWorldPosition(_headPos);
        xrCamera.getWorldQuaternion(_headQuat);
        return { position: _headPos, quaternion: _headQuat };
    }

    const arScene =
        mode === 'immersive-ar' ? createXrArScene({ scene, renderer, xrWorld: rig.xrWorld }) : null;
    const placement =
        mode === 'immersive-ar' ? createXrArPlacement({ scene, rig, getHeadPose }) : null;

    const controllers = createXrControllers({
        renderer,
        scene,
        rig,
        hooks,
        handsEnabled,
        getHeadPose,
        getChrome,
        getPlacement: () => placement,
    });

    /** @type {XRSession | null} */
    let session = null;
    let presenting = false;
    /** @type {string | null} */
    let lastError = null;

    const ui = createXrUi({
        mode,
        onEnter: () => enterSession(),
        onExit: () => {
            session?.end?.();
        },
    });

    async function checkSupport() {
        const xr = navigator.xr;
        if (!xr?.isSessionSupported) {
            ui.setSupported(false);
            return false;
        }
        try {
            const ok = await xr.isSessionSupported(mode);
            ui.setSupported(ok);
            return ok;
        } catch {
            ui.setSupported(false);
            return false;
        }
    }

    function setPresenting(next) {
        if (next === presenting) return;
        presenting = next;
        ui.setPresenting(next);
        if (mode === 'immersive-ar') {
            if (next) {
                // Classify the room against the table footprint while xrWorld
                // is still at identity (scene units), then scale / place.
                rig.adoptSceneContent();
                arScene?.enter();
            } else {
                arScene?.exit();
            }
        }
        rig.applySeatedCalibration(next, { mode: mode === 'immersive-ar' ? 'ar' : 'vr' });
        onPresentingChange?.(next);
    }

    async function enterSession() {
        if (session || !navigator.xr) return;
        lastError = null;
        try {
            session = await navigator.xr.requestSession(
                mode,
                buildXrSessionInit(mode, { hands: handsEnabled })
            );
        } catch (err) {
            console.warn(`[XR] Failed to start ${mode} session:`, err);
            lastError = String(/** @type {Error} */ (err)?.message ?? err);
            ui.setError(lastError);
            session = null;
            return;
        }

        const started = session;
        started.addEventListener('end', () => {
            controllers.onSessionEnd();
            placement?.onSessionEnd();
            if (session === started) session = null;
            setPresenting(false);
        });

        // The layer's size is fixed for the session: apply the profile's
        // (possibly stepped-down) scale before three creates it.
        framebuffer.applyBeforeSession(renderer.xr);
        try {
            await renderer.xr.setSession(started);
        } catch (err) {
            // ?xr-webgpu on three r181: XRManager refuses a WebGPU backend.
            const message = String(/** @type {Error} */ (err)?.message ?? err);
            console.warn(
                `[XR] renderer.xr.setSession failed${webgpuExperiment ? ' (?xr-webgpu experiment)' : ''}:`,
                err
            );
            lastError = message;
            ui.setError(message);
            try {
                await started.end();
            } catch {
                /* already ended */
            }
            return;
        }
        controllers.onSessionStart(started);
        await placement?.onSessionStart(started);
        setPresenting(true);
    }

    void checkSupport();

    return {
        mode,
        rig,
        controllers,
        placement,
        arScene,
        framebuffer,
        ui,
        enterSession,
        getHeadPose,
        /** Seated recenter (VR) / move the table (AR). */
        recenter() {
            if (mode === 'immersive-ar') placement?.reset();
            else rig.resetSeat(getHeadPose());
        },
        /** @returns {boolean} */
        isPresenting: () => presenting || renderer.xr.isPresenting === true,
        getStats() {
            return {
                mode,
                presenting,
                hands: handsEnabled,
                handsTracked: controllers.hands?.anyTracked() ?? false,
                grab: controllers.grab.getGrabSource(),
                placement: placement?.getState() ?? null,
                arHidden: arScene?.hiddenCount ?? 0,
                ...framebuffer.getStats(),
                lastError,
            };
        },
        /**
         * @param {number} deltaTime
         */
        update(deltaTime) {
            const nowPresenting = renderer.xr.isPresenting === true;
            if (nowPresenting !== presenting && session) {
                setPresenting(nowPresenting);
            }
            if (!nowPresenting) return;
            // Dice spawned (or props re-rolled) mid-session join xrWorld.
            rig.adoptSceneContent();
            framebuffer.sample(deltaTime);
            const xr = /** @type {any} */ (renderer.xr);
            placement?.update(xr.getFrame?.(), xr.getReferenceSpace?.());
            controllers.update(deltaTime);
        },
        dispose() {
            session?.end?.();
            controllers.dispose();
            placement?.dispose();
            arScene?.exit();
            ui.dispose();
            renderer.xr.enabled = false;
        },
    };
}
