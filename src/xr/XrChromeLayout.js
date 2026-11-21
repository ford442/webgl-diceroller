/**
 * Layout + hit-testing for the XR session chrome panel (canvas texture on a
 * plane). Pure: canvas-pixel rectangles in, button id out, so the unit test
 * needs neither a canvas nor a scene.
 */

export const CHROME_CANVAS_W = 768;
export const CHROME_CANVAS_H = 512;
/** Physical panel size, meters (same 3:2 aspect as the canvas). */
export const CHROME_PANEL_W_M = 0.36;
export const CHROME_PANEL_H_M = 0.24;
export const CHROME_MAX_SEATS = 6;

const PAD = 28;
const BUTTON_H = 86;
const BUTTON_GAP = 18;

/**
 * @typedef {{ id: string, label: string, enabled?: boolean }} ChromeButtonSpec
 * @typedef {{ id: string, label: string, enabled: boolean, x: number, y: number, w: number, h: number }} ChromeButtonRect
 * @typedef {{
 *   title: string,
 *   seats: Array<{ name: string, current: boolean }>,
 *   overflow: number,
 *   lastExpression: string,
 *   buttons: ChromeButtonRect[],
 * }} ChromeLayout
 */

/**
 * @param {{
 *   seats?: Array<{ id: string, name: string }>,
 *   currentIndex?: number,
 *   lastExpression?: string | null,
 *   buttons: ChromeButtonSpec[],
 * }} input
 * @returns {ChromeLayout}
 */
export function layoutChrome({ seats = [], currentIndex = 0, lastExpression = null, buttons }) {
    const shown = seats.slice(0, CHROME_MAX_SEATS).map((s, i) => ({
        name: s.name,
        current: i === currentIndex,
    }));
    const count = Math.max(1, buttons.length);
    const w = (CHROME_CANVAS_W - PAD * 2 - BUTTON_GAP * (count - 1)) / count;
    const y = CHROME_CANVAS_H - PAD - BUTTON_H;
    return {
        title: 'Initiative',
        seats: shown,
        overflow: Math.max(0, seats.length - shown.length),
        lastExpression: lastExpression ?? '—',
        buttons: buttons.map((b, i) => ({
            id: b.id,
            label: b.label,
            enabled: b.enabled !== false,
            x: PAD + i * (w + BUTTON_GAP),
            y,
            w,
            h: BUTTON_H,
        })),
    };
}

/**
 * Which enabled button a ray hit, from the plane's UV (three's PlaneGeometry:
 * u left→right, v bottom→top).
 * @param {ChromeLayout} layout
 * @param {{ x: number, y: number } | null | undefined} uv
 * @returns {string | null}
 */
export function hitTestChrome(layout, uv) {
    if (!uv) return null;
    const px = uv.x * CHROME_CANVAS_W;
    const py = (1 - uv.y) * CHROME_CANVAS_H;
    for (const b of layout.buttons) {
        if (!b.enabled) continue;
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
    }
    return null;
}
