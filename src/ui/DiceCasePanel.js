import * as THREE from 'three';
import { DICE_MATERIAL_PRESETS, DICE_PRESET_IDS, isHighQualityProfile } from '../dice/DiceMaterials.js';
import { DICE_TYPES } from '../dice/DiceAppearanceConfig.js';

/**
 * Dice Case panel — per-type preset + color pickers with a live rotating preview.
 *
 * @param {object} hooks
 * @param {() => Record<string, { preset: string, bodyColor: string, pipColor: string }>} hooks.getConfig
 * @param {(type: string, partial: object) => void} hooks.onTypeChange
 * @param {(type: string) => THREE.Mesh|null} hooks.getTemplateMesh
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
        'box-shadow:0 8px 24px rgba(0,0,0,0.35)'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
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
    previewCanvas.style.cssText = 'width:100%;height:auto;border-radius:4px;background:rgba(0,0,0,0.35);display:block;margin-bottom:8px;';
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
    bodyColorInput.style.cssText = 'flex:1;height:28px;border:none;padding:0;background:transparent;cursor:pointer;';
    bodyColorRow.appendChild(bodyColorLabel);
    bodyColorRow.appendChild(bodyColorInput);
    body.appendChild(bodyColorRow);

    const pipColorRow = document.createElement('div');
    pipColorRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const pipColorLabel = document.createElement('label');
    pipColorLabel.textContent = 'Pips';
    pipColorLabel.style.fontSize = '12px';
    pipColorLabel.style.minWidth = '42px';
    const pipColorInput = document.createElement('input');
    pipColorInput.type = 'color';
    pipColorInput.style.cssText = 'flex:1;height:28px;border:none;padding:0;background:transparent;cursor:pointer;';
    pipColorRow.appendChild(pipColorLabel);
    pipColorRow.appendChild(pipColorInput);
    body.appendChild(pipColorRow);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:10px;opacity:0.75;line-height:1.35;margin-top:6px;';
    hint.textContent = 'Saved locally and included in shared roll links.';
    body.appendChild(hint);

    let collapsed = false;
    collapseBtn.addEventListener('click', () => {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'block';
        collapseBtn.textContent = collapsed ? '+' : '−';
    });

    [typeSelect, presetSelect, bodyColorInput, pipColorInput].forEach((el) => {
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    });

    const previewRenderer = new THREE.WebGLRenderer({
        canvas: previewCanvas,
        antialias: true,
        alpha: true
    });
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    previewRenderer.setSize(previewCanvas.width, previewCanvas.height, false);

    const previewScene = new THREE.Scene();
    const previewCamera = new THREE.PerspectiveCamera(35, previewCanvas.width / previewCanvas.height, 0.1, 50);
    previewCamera.position.set(0, 0.4, 2.4);

    const previewLight = new THREE.DirectionalLight(0xfff0dd, 1.4);
    previewLight.position.set(2, 4, 3);
    previewScene.add(previewLight);
    previewScene.add(new THREE.AmbientLight(0x8888aa, 0.45));

    let previewMesh = null;
    let selectedType = 'd6';
    let previewAngle = 0;

    function syncControlsFromConfig() {
        const config = hooks.getConfig();
        const entry = config[selectedType];
        if (!entry) return;
        presetSelect.value = entry.preset;
        bodyColorInput.value = entry.bodyColor;
        pipColorInput.value = entry.pipColor;

        const gemstone = DICE_MATERIAL_PRESETS.gemstone;
        const highQ = isHighQualityProfile(hooks.getQualityProfile?.());
        presetSelect.querySelector('option[value="gemstone"]').disabled = false;
        if (!highQ && entry.preset === 'gemstone') {
            hint.textContent = 'Gemstone uses a lighter faux-gem look on this quality profile.';
        } else if (!highQ) {
            hint.textContent = 'Saved locally and included in shared roll links. Gemstone needs high quality for transmission.';
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
        previewMesh.position.set(0, 0, 0);
        previewMesh.rotation.set(0.35, previewAngle, 0.15);
        previewScene.add(previewMesh);
    }

    function emitChange(partial) {
        hooks.onTypeChange(selectedType, partial);
        rebuildPreviewMesh();
        syncControlsFromConfig();
    }

    typeSelect.addEventListener('change', () => {
        selectedType = typeSelect.value;
        syncControlsFromConfig();
        rebuildPreviewMesh();
    });

    presetSelect.addEventListener('change', () => {
        emitChange({ preset: presetSelect.value });
    });
    bodyColorInput.addEventListener('input', () => {
        emitChange({ bodyColor: bodyColorInput.value });
    });
    pipColorInput.addEventListener('input', () => {
        emitChange({ pipColor: pipColorInput.value });
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
            if (!previewMesh) return;
            previewAngle += deltaTime * 0.55;
            previewMesh.rotation.y = previewAngle;
            const envMap = hooks.getEnvMap?.();
            if (envMap) previewScene.environment = envMap;
            previewRenderer.render(previewScene, previewCamera);
        },
        dispose() {
            if (previewMesh) previewScene.remove(previewMesh);
            previewRenderer.dispose();
            panel.remove();
        }
    };
}
