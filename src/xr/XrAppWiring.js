/**
 * XR app wiring (session, results HUD, world-space chrome, debug stats).
 * Loaded only through `src/app/XrBootstrap.js` when `isXrRequested()`, so
 * none of it reaches the desktop entry chunk.
 */

import { setDomResultsSuppressed } from '../results.js';
import { AppEvent } from '../core/AppEvents.js';
import { initXrSession } from './XrSession.js';
import { createXrResultsHud } from './XrResultsHud.js';
import { createXrChrome } from './XrChrome.js';

/**
 * Chrome buttons for the current state. Pure over its inputs so the label /
 * enabled rules are unit-testable.
 * @param {{ mode: 'immersive-vr' | 'immersive-ar', canPassTurn: boolean, hasTower: boolean }} state
 * @returns {Array<{ id: string, label: string, enabled: boolean }>}
 */
export function xrChromeButtons({ mode, canPassTurn, hasTower }) {
    const buttons = [{ id: 'pass', label: 'Pass turn', enabled: canPassTurn }];
    if (hasTower) buttons.push({ id: 'tower', label: 'Tower drop', enabled: true });
    buttons.push(
        mode === 'immersive-ar'
            ? { id: 'recenter', label: 'Move table', enabled: true }
            : { id: 'recenter', label: 'Recenter', enabled: true }
    );
    return buttons;
}

/**
 * @param {object} deps
 * @returns {Promise<Awaited<ReturnType<typeof initXrSession>> | null>}
 */
export async function wireXrApp(deps) {
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

    /** @type {ReturnType<typeof createXrResultsHud> | null} */
    let xrResultsHud = null;
    /** @type {ReturnType<typeof createXrChrome> | null} */
    let xrChrome = null;

    try {
        /** @type {Awaited<ReturnType<typeof initXrSession>>} */
        let xrSessionApi = null;
        xrSessionApi = await initXrSession({
            renderer,
            scene,
            camera,
            searchParams,
            getChrome: () => xrChrome,
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
                if (presenting) {
                    xrChrome?.show();
                } else {
                    xrResultsHud?.hide();
                    xrChrome?.hide();
                }
                appEvents.emit(AppEvent.XR_PRESENTING, {
                    presenting,
                    mode: xrSessionApi?.mode ?? null,
                });
            },
        });
        app.xr = xrSessionApi;
        if (!xrSessionApi) return null;

        const getAnchor = () => xrSessionApi?.rig?.tableAnchor ?? null;

        if (readAllDiceValues) {
            xrResultsHud = createXrResultsHud({
                appEvents,
                getAnchor,
                isPresenting: () => isXrPresentingRef.value,
                readAllDiceValues,
            });
            app.xrResultsHud = xrResultsHud;
        }

        const getTower = () =>
            /** @type {{ drop?: () => unknown } | undefined} */ (app.interactables?.diceTower);
        xrChrome = createXrChrome({
            appEvents,
            getAnchor,
            // app.session is wired after XR boots; read it lazily.
            getSnapshot: () => /** @type {any} */ (app.session?.getSnapshot?.() ?? null),
            getButtons: () =>
                xrChromeButtons({
                    mode: xrSessionApi.mode,
                    canPassTurn: app.session?.canPassTurn?.() ?? false,
                    hasTower: typeof getTower()?.drop === 'function',
                }),
            onButton: (id) => {
                if (id === 'pass') app.session?.passTurn?.();
                else if (id === 'tower') void getTower()?.drop?.();
                else if (id === 'recenter') xrSessionApi.recenter();
            },
        });
        app.xrChrome = xrChrome;

        scheduler.register('updates', 'xrSession', ({ deltaTime }) => {
            xrSessionApi?.update(deltaTime);
            xrChrome?.update();
            // `?debug-perf` reads this (RenderStats) — framebuffer scale,
            // its stepped-down next value, foveation, hands, AR placement.
            scheduler.stats.xr = xrSessionApi.getStats();
        });
        console.info(
            `[XR] ${xrSessionApi.mode} ready — use the Enter ${xrSessionApi.mode === 'immersive-ar' ? 'AR' : 'VR'} button when supported.`
        );
        return xrSessionApi;
    } catch (err) {
        console.warn('[XR] Failed to initialize:', err);
        return null;
    }
}
