/**
 * WebXR bring-up (`?xr` seated VR, `?ar` table placement). Everything past
 * the flag check is dynamically imported (src/xr/XrAppWiring.js) so desktop
 * bundles stay free of XR code.
 */

import { isXrRequested } from '../xr/XrFlags.js';

/**
 * @param {object} deps see `wireXrApp` in src/xr/XrAppWiring.js
 * @returns {Promise<Awaited<ReturnType<typeof import('../xr/XrSession.js').initXrSession>> | null>}
 */
export async function bootstrapXr(deps) {
    if (!isXrRequested(deps.searchParams)) return null;
    try {
        const { wireXrApp } = await import('../xr/XrAppWiring.js');
        return await wireXrApp(deps);
    } catch (err) {
        console.warn('[XR] Failed to initialize:', err);
        return null;
    }
}
