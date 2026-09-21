import * as THREE from 'three';
import {
    DICE_MATERIAL_PRESETS,
    DICE_PRESET_IDS,
    isHighQualityProfile,
} from '../dice/DiceMaterials.js';
import { MARKING_STYLES } from '../dice/DiceSetFormat.js';
import { prefersReducedMotion } from '../core/AccessibilityPrefs.js';
import { createHudPanel, hudSelect } from './hudPanel.js';

/** Die keys the case offers. The derived types are descriptor-only for now. */
const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

/**
 * Dice Case panel — per-die finish, colours and marking style, with a live
 * rotating preview.
 *
 * It edits the active `DiceSet` directly: there is no per-type appearance triple
 * behind it any more, so what the panel shows is what a share link carries.
 *
 * @param {object} hooks
 * @param {() => import('../dice/DiceSetFormat.js').DiceSet} hooks.getDiceSet
 * @param {(dieKey: string, patch: object) => void} hooks.onEntryChange
 * @param {(type: string) => THREE.Mesh|null} hooks.getTemplateMesh
 * @param {(dieKey: string) => { materials: THREE.Material[], dispose: () => void }|null} [hooks.buildPreviewMaterials]
 * @param {() => THREE.Texture|null} [hooks.getEnvMap]
 * @param {() => object|null} [hooks.getQualityProfile]
 */
export function createDiceCasePanel(hooks) {
    const hudPanel = createHudPanel({
        id: 'dice-case-panel',
        ariaLabel: 'Dice case',
        anchor: 'center-left',
        title: 'Dice Case',
        collapsible: true,
        className: 'hud-panel--dice-case',
    });
    const { el: panel, body, collapseButton: collapseBtn } = hudPanel;

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 160;
    previewCanvas.height = 120;
    previewCanvas.className = 'hud-dice-case-preview';
    body.appendChild(previewCanvas);

    const typeRow = document.createElement('div');
    typeRow.className = 'hud-row hud-mt-xs';
    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Die';
    typeLabel.className = 'hud-label';
    const typeSelect = hudSelect('Die type');
    typeSelect.style.flex = '1';
    DICE_TYPES.forEach((type) => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type.toUpperCase();
        typeSelect.appendChild(opt);
    });
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    body.appendChild(typeRow);

    const presetRow = document.createElement('div');
    presetRow.className = 'hud-row hud-mt-xs';
    const presetLabel = document.createElement('label');
    presetLabel.textContent = 'Finish';
    presetLabel.className = 'hud-label';
    const presetSelect = hudSelect('Dice finish preset');
    presetSelect.style.flex = '1';
    DICE_PRESET_IDS.forEach((id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = DICE_MATERIAL_PRESETS[id].label;
        presetSelect.appendChild(opt);
    });
    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    body.appendChild(presetRow);

    const bodyColorRow = document.createElement('div');
    bodyColorRow.className = 'hud-row hud-mt-xs';
    const bodyColorLabel = document.createElement('label');
    bodyColorLabel.textContent = 'Body';
    bodyColorLabel.className = 'hud-label hud-label--fixed';
    const bodyColorInput = document.createElement('input');
    bodyColorInput.type = 'color';
    bodyColorInput.className = 'hud-color-input';
    bodyColorInput.setAttribute('aria-label', 'Body color');
    bodyColorRow.appendChild(bodyColorLabel);
    bodyColorRow.appendChild(bodyColorInput);
    body.appendChild(bodyColorRow);

    const pipColorRow = document.createElement('div');
    pipColorRow.className = 'hud-row hud-mt-xs';
    const pipColorLabel = document.createElement('label');
    pipColorLabel.textContent = 'Marks';
    pipColorLabel.className = 'hud-label hud-label--fixed';
    const pipColorInput = document.createElement('input');
    pipColorInput.type = 'color';
    pipColorInput.className = 'hud-color-input';
    pipColorInput.setAttribute('aria-label', 'Marking color');
    pipColorRow.appendChild(pipColorLabel);
    pipColorRow.appendChild(pipColorInput);
    body.appendChild(pipColorRow);

    const styleRow = document.createElement('div');
    styleRow.className = 'hud-row hud-mt-xs';
    const styleLabel = document.createElement('label');
    styleLabel.textContent = 'Cut';
    styleLabel.className = 'hud-label hud-label--fixed';
    const styleSelect = hudSelect('Marking style');
    styleSelect.style.flex = '1';
    MARKING_STYLES.forEach((style) => {
        const opt = document.createElement('option');
        opt.value = style;
        opt.textContent = style[0].toUpperCase() + style.slice(1);
        styleSelect.appendChild(opt);
    });
    styleRow.appendChild(styleLabel);
    styleRow.appendChild(styleSelect);
    body.appendChild(styleRow);

    const hint = document.createElement('div');
    hint.className = 'hud-status-line hud-mt-xs';
    hint.textContent = 'Saved locally and included in shared roll links.';
    body.appendChild(hint);

    let previewRenderer = null;
    collapseBtn.title = 'Collapse dice case';
    hudPanel.setCollapsed(false);
    const baseSetCollapsed = hudPanel.setCollapsed;
    hudPanel.setCollapsed = (next) => {
        baseSetCollapsed(next);
        if (next) disposePreviewRenderer();
    };

    [typeSelect, presetSelect, styleSelect, bodyColorInput, pipColorInput].forEach((el) => {
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    });

    const previewScene = new THREE.Scene();
    const previewCamera = new THREE.PerspectiveCamera(
        35,
        previewCanvas.width / previewCanvas.height,
        0.1,
        50
    );
    previewCamera.position.set(0, 0.4, 2.4);

    const previewLight = new THREE.DirectionalLight(0xfff0dd, 1.4);
    previewLight.position.set(2, 4, 3);
    previewScene.add(previewLight);
    previewScene.add(new THREE.AmbientLight(0x8888aa, 0.45));

    /**
     * Live PBR preview needs its own GL context (cloned die + env map). Do not
     * use high-performance: browsers cap GL contexts (8–16) and Intel /
     * SwiftShader / Quest hit that first. Lazy-create a low-power context and
     * dispose it on collapse so the slot is released.
     */
    function ensurePreviewRenderer() {
        if (previewRenderer || hudPanel.isCollapsed()) return previewRenderer;
        previewRenderer = new THREE.WebGLRenderer({
            canvas: previewCanvas,
            antialias: false,
            alpha: true,
            stencil: false,
            depth: true,
            powerPreference: 'low-power',
            preserveDrawingBuffer: false,
        });
        previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
        previewRenderer.setPixelRatio(1);
        previewRenderer.setSize(previewCanvas.width, previewCanvas.height, false);
        return previewRenderer;
    }

    function disposePreviewRenderer() {
        if (!previewRenderer) return;
        previewRenderer.dispose();
        previewRenderer.forceContextLoss?.();
        previewRenderer = null;
    }

    let previewMesh = null;
    let previewMaterials = null;
    let selectedType = 'd6';
    let previewAngle = 0;

    function syncControlsFromConfig() {
        const entry = hooks.getDiceSet().dice[selectedType];
        if (!entry) return;
        presetSelect.value = entry.body.preset;
        bodyColorInput.value = entry.body.bodyColor;
        pipColorInput.value = entry.body.markingColor;
        styleSelect.value = entry.faces.style;

        const highQ = isHighQualityProfile(hooks.getQualityProfile?.());
        /** @type {HTMLOptionElement | null} */ (
            presetSelect.querySelector('option[value="gemstone"]')
        ).disabled = false;
        if (!highQ && entry.body.preset === 'gemstone') {
            hint.textContent = 'Gemstone uses a lighter faux-gem look on this quality profile.';
        } else if (!highQ) {
            hint.textContent =
                'Saved locally and included in shared roll links. Gemstone needs high quality for transmission.';
        } else {
            hint.textContent = 'Saved locally and included in shared roll links.';
        }
    }

    function rebuildPreviewMesh() {
        if (previewMesh) {
            previewScene.remove(previewMesh);
            previewMesh = null;
        }
        const template = hooks.getTemplateMesh(selectedType);
        if (!template) return;

        previewMesh = template.clone();

        // This panel renders through its own WebGLRenderer (see below), so it
        // cannot wear the table's material when the table is drawn by WebGPU —
        // a node material dies inside WebGLProgram. Ask for the WebGL twin of
        // the same descriptor entry instead.
        const built = hooks.buildPreviewMaterials?.(selectedType) ?? null;
        if (built) {
            previewMesh.material =
                previewMesh.geometry?.groups?.length >= 2 && built.materials.length >= 2
                    ? built.materials
                    : built.materials[0];
            previewMaterials?.dispose();
            previewMaterials = built;
        }

        previewMesh.position.set(0, 0, 0);
        previewMesh.rotation.set(0.35, previewAngle, 0.15);
        previewScene.add(previewMesh);
    }

    function emitChange(patch) {
        hooks.onEntryChange(selectedType, patch);
        rebuildPreviewMesh();
        syncControlsFromConfig();
    }

    typeSelect.addEventListener('change', () => {
        selectedType = typeSelect.value;
        syncControlsFromConfig();
        rebuildPreviewMesh();
    });

    presetSelect.addEventListener('change', () => {
        emitChange({ body: { preset: presetSelect.value } });
    });
    styleSelect.addEventListener('change', () => {
        emitChange({ faces: { style: styleSelect.value } });
    });
    bodyColorInput.addEventListener('input', () => {
        emitChange({ body: { bodyColor: bodyColorInput.value } });
    });
    pipColorInput.addEventListener('input', () => {
        emitChange({ body: { markingColor: pipColorInput.value } });
    });

    syncControlsFromConfig();
    rebuildPreviewMesh();

    return {
        setSelectedType(type) {
            if (!DICE_TYPES.includes(type)) return;
            selectedType = type;
            typeSelect.value = type;
            syncControlsFromConfig();
            rebuildPreviewMesh();
        },
        refresh() {
            syncControlsFromConfig();
            rebuildPreviewMesh();
        },
        updatePreview(deltaTime) {
            if (hudPanel.isCollapsed()) return;
            if (!previewMesh) return;
            const renderer = ensurePreviewRenderer();
            if (!renderer) return;
            if (!prefersReducedMotion()) {
                previewAngle += deltaTime * 0.55;
                previewMesh.rotation.y = previewAngle;
            }
            const envMap = hooks.getEnvMap?.();
            if (envMap) previewScene.environment = envMap;
            renderer.render(previewScene, previewCamera);
        },
        dispose() {
            if (previewMesh) previewScene.remove(previewMesh);
            previewMaterials?.dispose();
            previewMaterials = null;
            disposePreviewRenderer();
            panel.remove();
        },
    };
}
