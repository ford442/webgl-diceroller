import * as THREE from 'three';
import {
    DICE_MATERIAL_PRESETS,
    DICE_PRESET_IDS,
    isHighQualityProfile,
} from '../dice/DiceMaterials.js';
import { MARKING_STYLES } from '../dice/DiceSetFormat.js';

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
    const canvasContainer = document.getElementById('canvas-container') || document.body;

    const panel = document.createElement('div');
    panel.style.cssText = [
        'position:absolute',
        'left:10px',
        'top:50%',
        'transform:translateY(-50%)',
        'background:rgba(0,0,0,0.55)',
        'color:white',
        'font-family:sans-serif',
        'border-radius:6px',
        'padding:10px',
        'z-index:1000',
        'width:min(92vw, 220px)',
        'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    const title = document.createElement('div');
    title.textContent = 'Dice Case';
    title.style.fontWeight = 'bold';
    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '−';
    collapseBtn.title = 'Collapse dice case';
    collapseBtn.style.cssText = 'cursor:pointer;min-width:28px;';
    header.appendChild(title);
    header.appendChild(collapseBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    panel.appendChild(body);

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 160;
    previewCanvas.height = 120;
    previewCanvas.style.cssText =
        'width:100%;height:auto;border-radius:4px;background:rgba(0,0,0,0.35);display:block;margin-bottom:8px;';
    body.appendChild(previewCanvas);

    const typeRow = document.createElement('div');
    typeRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Die';
    typeLabel.style.fontSize = '12px';
    const typeSelect = document.createElement('select');
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
    presetRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const presetLabel = document.createElement('label');
    presetLabel.textContent = 'Finish';
    presetLabel.style.fontSize = '12px';
    const presetSelect = document.createElement('select');
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
    bodyColorRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const bodyColorLabel = document.createElement('label');
    bodyColorLabel.textContent = 'Body';
    bodyColorLabel.style.fontSize = '12px';
    bodyColorLabel.style.minWidth = '42px';
    const bodyColorInput = document.createElement('input');
    bodyColorInput.type = 'color';
    bodyColorInput.style.cssText =
        'flex:1;height:28px;border:none;padding:0;background:transparent;cursor:pointer;';
    bodyColorRow.appendChild(bodyColorLabel);
    bodyColorRow.appendChild(bodyColorInput);
    body.appendChild(bodyColorRow);

    const pipColorRow = document.createElement('div');
    pipColorRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const pipColorLabel = document.createElement('label');
    pipColorLabel.textContent = 'Marks';
    pipColorLabel.style.fontSize = '12px';
    pipColorLabel.style.minWidth = '42px';
    const pipColorInput = document.createElement('input');
    pipColorInput.type = 'color';
    pipColorInput.style.cssText =
        'flex:1;height:28px;border:none;padding:0;background:transparent;cursor:pointer;';
    pipColorRow.appendChild(pipColorLabel);
    pipColorRow.appendChild(pipColorInput);
    body.appendChild(pipColorRow);

    const styleRow = document.createElement('div');
    styleRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const styleLabel = document.createElement('label');
    styleLabel.textContent = 'Cut';
    styleLabel.style.fontSize = '12px';
    styleLabel.style.minWidth = '42px';
    const styleSelect = document.createElement('select');
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
    hint.style.cssText = 'font-size:10px;opacity:0.75;line-height:1.35;margin-top:6px;';
    hint.textContent = 'Saved locally and included in shared roll links.';
    body.appendChild(hint);

    let collapsed = false;
    let previewRenderer = null;
    collapseBtn.addEventListener('click', () => {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'block';
        collapseBtn.textContent = collapsed ? '+' : '−';
        if (collapsed) {
            disposePreviewRenderer();
        }
    });

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
        if (previewRenderer || collapsed) return previewRenderer;
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

        const _gemstone = DICE_MATERIAL_PRESETS.gemstone;
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

    canvasContainer.appendChild(panel);

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
            if (collapsed) return;
            if (!previewMesh) return;
            const renderer = ensurePreviewRenderer();
            if (!renderer) return;
            previewAngle += deltaTime * 0.55;
            previewMesh.rotation.y = previewAngle;
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
