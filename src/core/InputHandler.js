import { getHoveredDie } from '../interaction.js';
import { isTouchPrimaryDevice } from './DeviceCapabilities.js';
import { setupTouchInput } from './TouchInput.js';

export function setupInput({
    renderer,
    camera,
    interaction,
    cameraController,
    diceFocusStateRef,
    isLockedRef,
    cursorPos,
    crosshairUI,
    onRoll,
    onRerollLayout,
    onLampKey,
    getLampData
}) {
    const keys = {};
    let hoverCheckPending = false;
    let lastHoverNormX = 0;
    let lastHoverNormY = 0;
    const touchPrimary = isTouchPrimaryDevice();

    const getContainerRect = () => {
        const container = document.getElementById('canvas-container');
        return container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
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
            if (!isLockedRef.value && diceFocusStateRef.value === 'IDLE') {
                renderer.domElement.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            const wasLocked = isLockedRef.value;
            isLockedRef.value = document.pointerLockElement === renderer.domElement;
            if (crosshairUI) crosshairUI.setVisible(isLockedRef.value);
            if (isLockedRef.value && !wasLocked) {
                cursorPos.set(0, 0);
            }
        });
    } else if (crosshairUI) {
        crosshairUI.setVisible(false);
    }

    document.addEventListener('mousemove', (event) => {
        if (touchPrimary || diceFocusStateRef.value !== 'IDLE') return;

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
        if (touchPrimary || event.button !== 0) return;
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
        if (touchPrimary || event.button !== 0) return;
        if (interaction) interaction.handleUp();
        renderer.domElement.style.cursor = 'default';
    });

    renderer.domElement.addEventListener('mouseleave', () => {
        if (touchPrimary) return;
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
        getContainerRect
    });

    return { keys, touchPrimary, touchInput };
}
