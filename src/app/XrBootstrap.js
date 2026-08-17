/**
 * WebXR seated-table spike bring-up. Dynamically imported so desktop bundles
 * stay free of XR code; only runs when `?xr` (or equivalent) is requested.
 */

import { isXrRequested } from '../xr/XrFlags.js';
import { setDomResultsSuppressed } from '../results.js';

/**
 * @param {object} deps
 * @returns {Promise<Awaited<ReturnType<typeof import('../xr/XrSession.js').initXrSession>> | null>}
 */
export async function bootstrapXr(deps) {
    const {
        searchParams,
        app,
        appEvents,
        scheduler,
        renderer,
        scene,
        camera,
        getShadowController,
        isXrPresentingRef,
        getCrosshairUI,
        readAllDiceValues,
    } = deps;

    if (!isXrRequested(searchParams)) return null;

    /** @type {ReturnType<typeof import('../xr/XrResultsHud.js').createXrResultsHud> | null} */
    let xrResultsHud = null;

    try {
        const { initXrSession } = await import('../xr/XrSession.js');
        const { createXrResultsHud } = await import('../xr/XrResultsHud.js');
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
                setDomResultsSuppressed(presenting);
                if (presenting && document.pointerLockElement) {
                    document.exitPointerLock();
                }
                getCrosshairUI()?.setVisible(!presenting && document.pointerLockElement != null);
                if (!presenting) {
                    xrResultsHud?.hide();
                }
            },
        });
        app.xr = xrSessionApi;

        if (xrSessionApi && readAllDiceValues) {
            xrResultsHud = createXrResultsHud({
                appEvents,
                getXrWorld: () => xrSessionApi.rig?.xrWorld ?? null,
                readAllDiceValues,
            });
            app.xrResultsHud = xrResultsHud;
        }

        scheduler.register('updates', 'xrSession', ({ deltaTime }) => {
            xrSessionApi?.update(deltaTime);
        });
        console.info(
            '[XR] Seated-table spike ready — use Enter VR when immersive-vr is available.'
        );
        return xrSessionApi;
    } catch (err) {
        console.warn('[XR] Failed to initialize:', err);
        return null;
    }
}
