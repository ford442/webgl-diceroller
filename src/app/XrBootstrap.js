/**
 * WebXR seated-table spike bring-up. Dynamically imported so desktop bundles
 * stay free of XR code; only runs when `?xr` (or equivalent) is requested.
 */

import { isXrRequested } from '../xr/XrFlags.js';

/**
 * @param {object} deps
 * @returns {Promise<Awaited<ReturnType<typeof import('../xr/XrSession.js').initXrSession>> | null>}
 */
export async function bootstrapXr(deps) {
    const {
        searchParams,
        app,
        scheduler,
        renderer,
        scene,
        camera,
        getShadowController,
        isXrPresentingRef,
        getCrosshairUI,
    } = deps;

    if (!isXrRequested(searchParams)) return null;

    try {
        const { initXrSession } = await import('../xr/XrSession.js');
        const xrSessionApi = await initXrSession({
            renderer,
            scene,
            camera,
            hooks: {
                onMotionActivityChange: (active, source) => {
                    const shadowController = getShadowController();
                    if (!shadowController) return;
                    if (active) shadowController.noteMotionStart(source);
                    else shadowController.noteMotionEnd(source);
                },
            },
            onPresentingChange: (presenting) => {
                isXrPresentingRef.value = presenting;
                if (presenting && document.pointerLockElement) {
                    document.exitPointerLock();
                }
                getCrosshairUI()?.setVisible(false);
            },
        });
        app.xr = xrSessionApi;
        scheduler.register('updates', 'xrSession', ({ deltaTime }) => {
            xrSessionApi?.update(deltaTime);
        });
        console.info('[XR] Seated-table spike ready — use Enter VR when immersive-vr is available.');
        return xrSessionApi;
    } catch (err) {
        console.warn('[XR] Failed to initialize:', err);
        return null;
    }
}
