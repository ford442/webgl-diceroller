import { createXrRig } from './XrRig.js';
import { createXrControllers } from './XrControllers.js';
import { createXrUi } from './XrUi.js';

/**
 * Boot WebXR for the seated-table spike. Call only when `isXrRequested()`.
 *
 * @param {object} options
 * @param {import('three').WebGLRenderer} options.renderer
 * @param {import('three').Scene} options.scene
 * @param {import('three').PerspectiveCamera} options.camera
 * @param {{ onMotionActivityChange?: (active: boolean, reason: 'drag') => void }} [options.hooks]
 * @param {(presenting: boolean) => void} [options.onPresentingChange]
 */
export async function initXrSession({
    renderer,
    scene,
    camera: _camera,
    hooks = {},
    onPresentingChange,
}) {
    if (!renderer.xr) {
        console.warn('[XR] renderer.xr unavailable — WebGLRenderer required.');
        return null;
    }

    renderer.xr.enabled = true;

    const rig = createXrRig(scene);
    const controllers = createXrControllers({ renderer, scene, rig, hooks });

    /** @type {XRSession | null} */
    let session = null;
    let presenting = false;

    const ui = createXrUi({
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
            const ok = await xr.isSessionSupported('immersive-vr');
            ui.setSupported(ok);
            return ok;
        } catch {
            ui.setSupported(false);
            return false;
        }
    }

    function setPresenting(next) {
        presenting = next;
        ui.setPresenting(next);
        rig.applySeatedCalibration(next);
        onPresentingChange?.(next);
    }

    async function enterSession() {
        if (session || !navigator.xr) return;
        try {
            session = await navigator.xr.requestSession('immersive-vr', {
                optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
            });
        } catch (err) {
            console.warn('[XR] Failed to start immersive-vr session:', err);
            session = null;
            return;
        }

        session.addEventListener('end', () => {
            controllers.onSessionEnd();
            session = null;
            setPresenting(false);
        });

        await renderer.xr.setSession(session);
        controllers.onSessionStart(session);
        setPresenting(true);
    }

    void checkSupport();

    return {
        rig,
        controllers,
        ui,
        enterSession,
        /** @returns {boolean} */
        isPresenting: () => presenting || renderer.xr.isPresenting === true,
        /**
         * @param {number} deltaTime
         */
        update(deltaTime) {
            const nowPresenting = renderer.xr.isPresenting === true;
            if (nowPresenting !== presenting) {
                setPresenting(nowPresenting);
            }
            if (nowPresenting) {
                controllers.update(deltaTime);
            }
        },
        dispose() {
            session?.end?.();
            controllers.dispose();
            ui.dispose();
            renderer.xr.enabled = false;
        },
    };
}
