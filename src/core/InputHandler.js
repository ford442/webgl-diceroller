import { getHoveredDie } from '../interaction.js';
import { isTouchPrimaryDevice } from './DeviceCapabilities.js';
import { setupTouchInput } from './TouchInput.js';

/**
 * @param {object} config
 * @param {import('three').WebGLRenderer | import('three/webgpu').WebGPURenderer} config.renderer
 * @param {import('three').Camera} config.camera
 * @param {ReturnType<typeof import('../interaction.js').initInteraction>} config.interaction
 * @param {ReturnType<typeof import('./CameraController.js').createCameraController>} config.cameraController
 * @param {{ value: string }} config.diceFocusStateRef
 * @param {{ value: boolean }} config.isLockedRef
 * @param {() => boolean} [config.isXrPresenting]
 * @param {import('three').Vector2} config.cursorPos
 * @param {ReturnType<typeof import('../ui.js').createCrosshair> | null | undefined} config.crosshairUI
 * @param {(seed?: number | null) => void} config.onRoll
 * @param {(() => void | Promise<void>) | null} [config.onRerollLayout]
 * @param {() => unknown} [config._onLampKey]
 * @param {() => { handleKey?: (key: string) => void; setRolling?: (rolling: boolean) => void } | null | undefined} [config.getLampData]
 * @param {() => void} [config.onCupPourKey]
 */
export function setupInput({
    renderer,
    camera,
    interaction,
    cameraController,
    diceFocusStateRef,
    isLockedRef,
    isXrPresenting,
    cursorPos,
    crosshairUI,
    onRoll,
    onRerollLayout,
    _onLampKey,
    getLampData,
    onCupPourKey,
}) {
    const keys = {};
    let hoverCheckPending = false;
    let lastHoverNormX = 0;
    let lastHoverNormY = 0;
    const touchPrimary = isTouchPrimaryDevice();
    const xrActive = () => isXrPresenting?.() === true;

    const getContainerRect = () => {
        const container = document.getElementById('canvas-container');
        return container
            ? container.getBoundingClientRect()
            : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    };

    window.addEventListener('keydown', (event) => {
        keys[event.code] = true;
        if (event.code === 'KeyR') {
            if (event.shiftKey && onRerollLayout) {
                event.preventDefault();
                onRerollLayout();
            } else {
                onRoll();
            }
        }
        if (event.code === 'Escape') {
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        }
        if (event.code === 'KeyT') {
            onCupPourKey?.();
        }
        const lampData = getLampData ? getLampData() : null;
        if (lampData) {
            lampData.handleKey(event.key);
        }
    });

    window.addEventListener('keyup', (event) => {
        keys[event.code] = false;
    });

    if (!touchPrimary) {
        renderer.domElement.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            if (xrActive()) return;
            if (!isLockedRef.value && diceFocusStateRef.value === 'IDLE') {
                renderer.domElement.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            const wasLocked = isLockedRef.value;
            isLockedRef.value = document.pointerLockElement === renderer.domElement;
            if (crosshairUI) crosshairUI.setVisible(isLockedRef.value && !xrActive());
            if (isLockedRef.value && !wasLocked) {
                cursorPos.set(0, 0);
            }
        });
    } else if (crosshairUI) {
        crosshairUI.setVisible(false);
    }

    document.addEventListener('mousemove', (event) => {
        if (touchPrimary || xrActive() || diceFocusStateRef.value !== 'IDLE') return;

        if (isLockedRef.value) {
            cursorPos.x += event.movementX;
            cursorPos.y += event.movementY;
        } else {
            const rect = getContainerRect();
            const relX = event.clientX - rect.left;
            const relY = event.clientY - rect.top;
            const normX = (relX / rect.width) * 2 - 1;
            const normY = -(relY / rect.height) * 2 + 1;
            if (interaction) interaction.handleMove(normX, normY);

            lastHoverNormX = normX;
            lastHoverNormY = normY;
            if (!hoverCheckPending) {
                hoverCheckPending = true;
                requestAnimationFrame(() => {
                    const canvas = renderer.domElement;
                    const hoveredDie = getHoveredDie(camera, lastHoverNormX, lastHoverNormY);
                    canvas.style.cursor = hoveredDie ? 'grab' : 'default';
                    hoverCheckPending = false;
                });
            }
        }
    });

    renderer.domElement.addEventListener('mousedown', (event) => {
        if (touchPrimary || xrActive() || event.button !== 0) return;
        if (diceFocusStateRef.value === 'IDLE') {
            const rect = getContainerRect();
            const relX = event.clientX - rect.left;
            const relY = event.clientY - rect.top;
            const normX = (relX / rect.width) * 2 - 1;
            const normY = -(relY / rect.height) * 2 + 1;
            const hoveredDie = getHoveredDie(camera, normX, normY);
            if (hoveredDie) {
                renderer.domElement.style.cursor = 'grabbing';
            }

            if (isLockedRef.value) {
                if (interaction) interaction.handleDown(0, 0);
            } else if (interaction) {
                interaction.handleDown(normX, normY);
            }
        }
    });

    renderer.domElement.addEventListener('mouseup', (event) => {
        if (touchPrimary || xrActive() || event.button !== 0) return;
        if (interaction) interaction.handleUp();
        renderer.domElement.style.cursor = 'default';
    });

    renderer.domElement.addEventListener('mouseleave', () => {
        if (touchPrimary || xrActive()) return;
        if (interaction) interaction.handleUp();
        renderer.domElement.style.cursor = 'default';
    });

    const touchInput = setupTouchInput({
        renderer,
        camera,
        interaction,
        cameraController,
        diceFocusStateRef,
        onRoll,
        getContainerRect,
    });

    return { keys, touchPrimary, touchInput };
}
