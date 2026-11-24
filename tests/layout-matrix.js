// Cross-viewport layout check (#382): at every viewport in the matrix, the
// page must not scroll horizontally, no two visible HUD panels may overlap,
// every primary control must sit inside the viewport, and on touch
// viewports every button must be at least 44 px in its smaller dimension.
// Pure DOM geometry — no screenshots, so it is safe on a live scene and
// needs no WASM.
import { launchPage } from './helpers/browser.js';
import { BASE } from './helpers/server.js';

const VIEWPORTS = [
    { name: 'phone-portrait', width: 360, height: 640, touch: true },
    { name: 'phone-tall', width: 390, height: 844, touch: true },
    { name: 'phone-landscape', width: 844, height: 390, touch: true },
    { name: 'tablet-portrait', width: 768, height: 1024, touch: true },
    { name: 'tablet-landscape', width: 1024, height: 768, touch: true },
    { name: 'laptop', width: 1440, height: 900, touch: false },
    { name: 'desktop', width: 1920, height: 1080, touch: false },
    { name: 'ultrawide', width: 2560, height: 1080, touch: false },
];
const MIN_TOUCH = 44;
const url = `${BASE}/?webgl&no-post&fair-dice&test`;

function measure(touch, minTouch) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)
            return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    // HUD panels: fixed/absolute overlays that are direct children of body
    // (the canvas container and the loading overlay excluded).
    const panels = [...document.body.children].filter((el) => {
        if (!visible(el) || el.id === 'canvas-container' || el.tagName === 'CANVAS') return false;
        if (/loading/i.test(el.id)) return false;
        const pos = getComputedStyle(el).position;
        return pos === 'fixed' || pos === 'absolute';
    });
    const label = (el) => el.id || el.className || el.tagName;
    const rects = panels.map((el) => ({ name: label(el), r: el.getBoundingClientRect() }));
    const overlaps = [];
    for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i].r;
            const b = rects[j].r;
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            // Ignore full-viewport layers (crosshair hosts, live regions).
            const full = (r) => r.width >= vw - 1 && r.height >= vh - 1;
            if (w > 1 && h > 1 && !full(a) && !full(b))
                overlaps.push(`${rects[i].name} × ${rects[j].name}`);
        }
    const controls = [...document.querySelectorAll('button, input, select, a[href]')].filter(
        visible
    );
    const outside = [];
    const small = [];
    for (const el of controls) {
        const r = el.getBoundingClientRect();
        // A control inside a scrollable panel is reachable by scrolling it.
        let scroller = el.parentElement;
        while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
            scroller = scroller.parentElement;
        const offscreen = r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1;
        if (offscreen && !scroller) outside.push(label(el) || el.textContent.trim());
        if (touch && el.tagName === 'BUTTON' && Math.min(r.width, r.height) < minTouch)
            small.push(
                `${el.id || el.textContent.trim() || 'button'} (${Math.round(r.width)}×${Math.round(r.height)})`
            );
    }
    return {
        hScroll: document.documentElement.scrollWidth > vw + 1,
        overlaps,
        outside,
        small,
    };
}

(async () => {
    const { browser, page } = await launchPage({ context: true });
    const failures = [];
    try {
        for (const vp of VIEWPORTS) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto(url, { waitUntil: 'load', timeout: 60000 });
            await page.waitForFunction(() => window.__app?.ready === true, null, {
                timeout: 150000,
            });
            const m = await page.evaluate(`(${measure.toString()})(${vp.touch}, ${MIN_TOUCH})`);
            const problems = [];
            if (m.hScroll) problems.push('horizontal scroll');
            if (m.overlaps.length) problems.push(`overlap: ${m.overlaps.join(', ')}`);
            if (m.outside.length) problems.push(`off-screen: ${m.outside.join(', ')}`);
            if (m.small.length) problems.push(`< ${MIN_TOUCH}px: ${m.small.join(', ')}`);
            const tag = `${vp.name} ${vp.width}×${vp.height}`;
            if (problems.length) {
                failures.push(tag);
                console.error(`✗ ${tag}\n    ${problems.join('\n    ')}`);
            } else console.log(`✓ ${tag}`);
        }
    } finally {
        await browser.close();
    }
    if (process.env.LAYOUT_REPORT_ONLY === '1') process.exit(0);
    process.exit(failures.length ? 1 : 0);
})();
