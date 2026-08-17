/**
 * World-space roll totals for XR (parented to xrWorld).
 */

import * as THREE from 'three';
import { AppEvent } from '../core/AppEvents.js';

const PANEL_W = 512;
const PANEL_H = 256;

/**
 * @param {{
 *   appEvents: import('../types/app').AppEvents,
 *   getXrWorld: () => import('three').Group | null,
 *   readAllDiceValues: () => Array<{ type: string, value: number | null }>,
 * }} deps
 */
export function createXrResultsHud(deps) {
    const group = new THREE.Group();
    group.name = 'xrResultsHud';
    group.visible = false;

    const canvas = document.createElement('canvas');
    canvas.width = PANEL_W;
    canvas.height = PANEL_H;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.22), material);
    mesh.position.set(0, 0.42, -0.35);
    mesh.renderOrder = 999;
    group.add(mesh);

    function attachToXrWorld() {
        const xrWorld = deps.getXrWorld();
        if (!xrWorld) return;
        if (group.parent !== xrWorld) {
            xrWorld.add(group);
        }
        group.position.set(0, 0, 0);
    }

    function clearPanel() {
        if (!ctx) return;
        ctx.fillStyle = 'rgba(8, 4, 0, 0.82)';
        ctx.fillRect(0, 0, PANEL_W, PANEL_H);
        ctx.strokeStyle = '#8B6914';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, PANEL_W - 4, PANEL_H - 4);
        ctx.fillStyle = '#e8c882';
        ctx.font = 'bold 28px Palatino, serif';
        ctx.fillText('Rolling…', 24, 48);
        texture.needsUpdate = true;
    }

    function drawResults(title, lines) {
        if (!ctx) return;
        ctx.fillStyle = 'rgba(8, 4, 0, 0.88)';
        ctx.fillRect(0, 0, PANEL_W, PANEL_H);
        ctx.strokeStyle = '#8B6914';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, PANEL_W - 4, PANEL_H - 4);
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 32px Palatino, serif';
        ctx.fillText(title, 24, 44);
        ctx.fillStyle = '#e8c882';
        ctx.font = '22px Palatino, serif';
        let y = 80;
        for (const line of lines.slice(0, 5)) {
            ctx.fillText(line, 24, y);
            y += 30;
        }
        texture.needsUpdate = true;
    }

    function showFromDiceValues() {
        const dice = deps.readAllDiceValues();
        const valid = dice.filter((d) => d.value != null && d.value > 0);
        const total = valid.reduce((s, d) => s + (d.value ?? 0), 0);
        const lines = valid.map((d) => `${d.type}: ${d.value}`);
        drawResults(`Total ${total}`, lines.length ? lines : ['—']);
    }

    function showEvaluated(result) {
        const expr = result?.expression ?? 'Roll';
        const total = result?.total;
        drawResults(total != null ? `${expr} = ${total}` : String(expr), []);
    }

    deps.appEvents.on(AppEvent.ROLL_STARTED, () => {
        attachToXrWorld();
        group.visible = true;
        clearPanel();
    });

    deps.appEvents.on(AppEvent.ROLL_SETTLED, () => {
        attachToXrWorld();
        group.visible = true;
        showFromDiceValues();
    });

    deps.appEvents.on(AppEvent.ROLL_EVALUATED, (payload) => {
        const result = /** @type {{ result?: object }} */ (payload)?.result;
        if (!result) return;
        attachToXrWorld();
        group.visible = true;
        showEvaluated(result);
    });

    return {
        group,
        hide() {
            group.visible = false;
        },
        show() {
            group.visible = true;
        },
        destroy() {
            group.removeFromParent();
            texture.dispose();
            material.dispose();
            mesh.geometry.dispose();
        },
    };
}
