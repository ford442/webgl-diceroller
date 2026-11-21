/**
 * World-space session chrome for XR: initiative order, current actor, last
 * expression, and buttons (pass turn, tower drop, recenter / move table).
 *
 * Same technique as the character sheet: a canvas texture on a plane. It
 * hangs off the rig's `xrTableAnchor` (meters, at the velvet centre), so it
 * stays beside the table through snap turns, recenter and AR placement. The
 * DOM session strip is hidden while presenting (SessionWiring listens for
 * `xr:presenting`); this panel replaces it, reading the same SessionState.
 */

import * as THREE from 'three';
import { AppEvent } from '../core/AppEvents.js';
import {
    CHROME_CANVAS_H,
    CHROME_CANVAS_W,
    CHROME_PANEL_H_M,
    CHROME_PANEL_W_M,
    hitTestChrome,
    layoutChrome,
} from './XrChromeLayout.js';

/**
 * @typedef {{ id: string, label: string, enabled?: boolean }} ChromeButtonSpec
 */

/**
 * @param {{
 *   appEvents: import('../types/app').AppEvents,
 *   getAnchor: () => import('three').Object3D | null,
 *   getSnapshot: () => { seats?: Array<{ id: string, name: string }>, currentIndex?: number, lastExpression?: string | null } | null,
 *   getButtons: () => ChromeButtonSpec[],
 *   onButton: (id: string) => void,
 * }} deps
 */
export function createXrChrome(deps) {
    const canvas = document.createElement('canvas');
    canvas.width = CHROME_CANVAS_W;
    canvas.height = CHROME_CANVAS_H;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(CHROME_PANEL_W_M, CHROME_PANEL_H_M),
        material
    );
    mesh.name = 'xrChromePanel';
    mesh.renderOrder = 999;
    // Left of the table, turned toward the seat and tilted back a little.
    mesh.position.set(-0.6, 0.2, 0.05);
    mesh.rotation.set(-0.2, 0.95, 0, 'YXZ');

    const group = new THREE.Group();
    group.name = 'xrChrome';
    group.visible = false;
    group.add(mesh);

    let dirty = true;
    /** @type {string | null} */
    let hoveredId = null;
    let layout = layoutChrome({ buttons: [] });
    let buttonsKey = '';

    const markDirty = () => {
        dirty = true;
    };
    const offs = [
        deps.appEvents.on(AppEvent.SESSION_INITIATIVE, markDirty),
        deps.appEvents.on(AppEvent.SESSION_TURN, markDirty),
        deps.appEvents.on(AppEvent.ROLL_SETTLED, markDirty),
        deps.appEvents.on(AppEvent.ROLL_EVALUATED, markDirty),
    ];

    function attach() {
        const anchor = deps.getAnchor();
        if (anchor && group.parent !== anchor) anchor.add(group);
    }

    function draw() {
        const snapshot = deps.getSnapshot() ?? {};
        layout = layoutChrome({
            seats: snapshot.seats ?? [],
            currentIndex: snapshot.currentIndex ?? 0,
            lastExpression: snapshot.lastExpression ?? null,
            buttons: deps.getButtons(),
        });
        dirty = false;
        if (!ctx) return;
        const W = CHROME_CANVAS_W;
        const H = CHROME_CANVAS_H;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(8, 4, 0, 0.86)';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#8B6914';
        ctx.lineWidth = 5;
        ctx.strokeRect(3, 3, W - 6, H - 6);

        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 40px Palatino, serif';
        ctx.fillText(layout.title, 28, 58);

        ctx.font = '30px Palatino, serif';
        let y = 104;
        const colW = (W - 56) / 2;
        layout.seats.forEach((seat, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = 28 + col * colW;
            const yy = y + row * 44;
            ctx.fillStyle = seat.current ? '#ffd700' : '#e8c882';
            ctx.fillText(
                `${seat.current ? '▶ ' : '   '}${i + 1}. ${truncate(seat.name, 16)}`,
                x,
                yy
            );
        });
        y += Math.ceil(Math.max(1, layout.seats.length) / 2) * 44;
        if (layout.overflow > 0) {
            ctx.fillStyle = '#b89b68';
            ctx.fillText(`+${layout.overflow} more`, 28, y);
            y += 40;
        }
        ctx.fillStyle = '#e8c882';
        ctx.font = 'italic 28px Palatino, serif';
        ctx.fillText(`Last: ${truncate(layout.lastExpression, 34)}`, 28, Math.min(y + 8, 348));

        for (const b of layout.buttons) {
            const hovered = b.enabled && b.id === hoveredId;
            ctx.fillStyle = !b.enabled ? '#2a1d10' : hovered ? '#8a5c2a' : '#5c3d1e';
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.strokeStyle = hovered ? '#ffd700' : '#c4a574';
            ctx.lineWidth = hovered ? 5 : 3;
            ctx.strokeRect(b.x, b.y, b.w, b.h);
            ctx.fillStyle = b.enabled ? '#f5e6c8' : '#7a6a50';
            ctx.font = 'bold 28px Georgia, serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        }
        texture.needsUpdate = true;
    }

    /**
     * Button under a ray, or null (always null while the panel is hidden).
     * @param {import('three').Raycaster} raycaster
     * @returns {string | null}
     */
    function pick(raycaster) {
        if (!group.visible) return null;
        const hit = raycaster.intersectObject(mesh, false)[0];
        return hit ? hitTestChrome(layout, hit.uv) : null;
    }

    return {
        group,
        mesh,
        pick,
        /** @param {string | null} id */
        setHover(id) {
            if (id === hoveredId) return;
            hoveredId = id;
            dirty = true;
        },
        /** @param {string} id */
        press(id) {
            const button = layout.buttons.find((b) => b.id === id && b.enabled);
            if (!button) return false;
            deps.onButton(id);
            dirty = true;
            return true;
        },
        markDirty,
        show() {
            attach();
            group.visible = true;
            dirty = true;
        },
        hide() {
            group.visible = false;
            hoveredId = null;
        },
        update() {
            if (!group.visible) return;
            // Buttons depend on live state (tower present, AR placed): redraw
            // when their labels / enabled flags change, not every frame.
            const key = JSON.stringify(deps.getButtons());
            if (key !== buttonsKey) {
                buttonsKey = key;
                dirty = true;
            }
            if (dirty) draw();
        },
        getLayout: () => layout,
        destroy() {
            for (const off of offs) off();
            group.removeFromParent();
            texture.dispose();
            material.dispose();
            mesh.geometry.dispose();
        },
    };
}

/** @param {string} text @param {number} max */
function truncate(text, max) {
    const s = String(text ?? '');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
