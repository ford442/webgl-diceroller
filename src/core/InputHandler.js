import { getHoveredDie } from '../interaction.js';

export function setupInput({
    renderer,
    camera,
    interaction,
    diceFocusStateRef,
    isLockedRef,
    cursorPos,
    crosshairUI,
    onRoll,
    onLampKey,
    getLampData
}) {
    const keys = {};
    let hoverCheckPending = false;
    let lastHoverNormX = 0;
    let lastHoverNormY = 0;

    // Get container dimensions helper
    const getContainerRect = () => {
        const container = document.getElementById('canvas-container');
        return container ? container.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
    };

    window.addEventListener('keydown', (event) => {
        keys[event.code] = true;
        if (event.code === 'KeyR') {
            onRoll();
        }
        // ESC to exit pointer lock / enter UI mode
        if (event.code === 'Escape') {
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        }
        // Lamp mode controls
        const lampData = getLampData ? getLampData() : null;
        if (lampData) {
            lampData.handleKey(event.key);
        }
    });

    window.addEventListener('keyup', (event) => {
        keys[event.code] = false;
    });

    // Pointer Lock Request - RIGHT CLICK ONLY to enter FPS mode
    // Left click always interacts with dice/props
    renderer.domElement.addEventListener('contextmenu', (event) => {
        event.preventDefault(); // Prevent browser context menu
        if (!isLockedRef.value && diceFocusStateRef.value === 'IDLE') {
            renderer.domElement.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        const wasLocked = isLockedRef.value;
        isLockedRef.value = document.pointerLockElement === renderer.domElement;
        if (crosshairUI) crosshairUI.setVisible(isLockedRef.value);
        if (isLockedRef.value && !wasLocked) {
            // Reset cursor to center when locking
            cursorPos.set(0, 0);
        }
    });

    // Throttle hover raycasting: only run once per animation frame to avoid
    // O(n) raycast cost firing 60-120 times/second during cursor movement.

    // Mouse Movement Tracking for FPS camera AND normal interaction
    document.addEventListener('mousemove', (event) => {
        if (diceFocusStateRef.value !== 'IDLE') return;

        if (isLockedRef.value) {
            // FPS mode: accumulate raw mouse movement for camera rotation
            cursorPos.x += event.movementX;
            cursorPos.y += event.movementY;
            // Note: rotation is applied in animate() loop, then cursorPos is reset
        } else {
            // Unlocked: Use coordinates relative to canvas container for dice interaction
            const rect = getContainerRect();
            const relX = event.clientX - rect.left;
            const relY = event.clientY - rect.top;
            const normX = (relX / rect.width) * 2 - 1;
            const normY = -(relY / rect.height) * 2 + 1;
            // Drag responsiveness: always forward move events immediately
            if (interaction) interaction.handleMove(normX, normY);

            // Hover cursor update: batch at frame boundary to avoid redundant raycasts
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

    // Pass clicks to interaction (left click only for dice)
    renderer.domElement.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return; // Only left click
        if (diceFocusStateRef.value === 'IDLE') {
            // Change cursor to grabbing when clicking a die
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
                // FPS mode: crosshair is always centered, shoot ray from center
                if (interaction) interaction.handleDown(0, 0);
            } else {
                // Unlocked: Allow clicking dice with coordinates relative to canvas
                if (interaction) interaction.handleDown(normX, normY);
            }
        }
    });

    renderer.domElement.addEventListener('mouseup', (event) => {
        if (event.button !== 0) return; // Only left click
        // Always trigger handleUp so we can drop dice regardless of lock state
        if (interaction) interaction.handleUp();
        // Reset cursor
        renderer.domElement.style.cursor = 'default';
    });

    // Handle mouse leaving canvas - drop any dragged dice
    renderer.domElement.addEventListener('mouseleave', () => {
        if (interaction) interaction.handleUp();
        renderer.domElement.style.cursor = 'default';
    });

    return { keys };
}
