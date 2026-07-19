import * as THREE from 'three';
import { getHoveredDie, isHoveringOverDice } from '../interaction.js';
import { applyFlickImpulseToDice } from '../dice.js';
import { isTouchPrimaryDevice } from './DeviceCapabilities.js';

const LONG_PRESS_MS = 450;
const FLICK_MIN_SPEED = 0.35; // px/ms
const FLICK_MIN_DISTANCE = 24;
const PINCH_ZOOM_SENSITIVITY = 0.004;

function touchDistance(t0, t1) {
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.hypot(dx, dy);
}

function touchCenter(t0, t1) {
    return {
        x: (t0.clientX + t1.clientX) * 0.5,
        y: (t0.clientY + t1.clientY) * 0.5
    };
}

export function setupTouchInput({
    renderer,
    camera,
    interaction,
    cameraController,
    diceFocusStateRef,
    onRoll,
    getContainerRect
}) {
    if (!isTouchPrimaryDevice()) {
        return { enabled: false };
    }

    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';

    const activeTouches = new Map();
    let longPressTimer = null;
    let longPressTriggered = false;
    let primaryTouchId = null;
    let startClient = { x: 0, y: 0 };
    let lastClient = { x: 0, y: 0 };
    let startTime = 0;
    let pinchStartDistance = 0;
    let orbitActive = false;

    const clearLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    const toNorm = (clientX, clientY) => {
        const rect = getContainerRect();
        const relX = clientX - rect.left;
        const relY = clientY - rect.top;
        return {
            normX: (relX / rect.width) * 2 - 1,
            normY: -(relY / rect.height) * 2 + 1
        };
    };

    const canInteract = () => diceFocusStateRef.value === 'IDLE';

    const onTouchStart = (event) => {
        if (!canInteract()) return;

        for (const touch of event.changedTouches) {
            activeTouches.set(touch.identifier, touch);
        }

        if (activeTouches.size === 1) {
            const touch = [...activeTouches.values()][0];
            primaryTouchId = touch.identifier;
            startClient = { x: touch.clientX, y: touch.clientY };
            lastClient = { ...startClient };
            startTime = performance.now();
            longPressTriggered = false;

            const { normX, normY } = toNorm(touch.clientX, touch.clientY);
            const hoveredDie = getHoveredDie(camera, normX, normY);

            clearLongPress();
            if (hoveredDie) {
                longPressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    interaction?.handleDown(normX, normY);
                }, LONG_PRESS_MS);
            }
        } else if (activeTouches.size === 2) {
            clearLongPress();
            orbitActive = true;
            const [t0, t1] = [...activeTouches.values()];
            pinchStartDistance = touchDistance(t0, t1);
            interaction?.handleUp();
        }
    };

    const onTouchMove = (event) => {
        if (!canInteract()) return;
        event.preventDefault();

        for (const touch of event.changedTouches) {
            activeTouches.set(touch.identifier, touch);
        }

        if (activeTouches.size >= 2) {
            clearLongPress();
            orbitActive = true;
            const [t0, t1] = [...activeTouches.values()];
            const dist = touchDistance(t0, t1);
            const center = touchCenter(t0, t1);

            if (pinchStartDistance > 0) {
                const scaleDelta = (dist - pinchStartDistance) * PINCH_ZOOM_SENSITIVITY;
                cameraController?.applyTouchZoom?.(1 - scaleDelta);
            }
            pinchStartDistance = dist;

            const { normX, normY } = toNorm(center.x, center.y);
            const prev = toNorm(lastClient.x, lastClient.y);
            const deltaYaw = (normX - prev.normX) * -2.5;
            const deltaPitch = (normY - prev.normY) * -2.5;
            cameraController?.applyTouchOrbit?.(deltaYaw, deltaPitch);
            lastClient = { x: center.x, y: center.y };
            return;
        }

        const touch = activeTouches.get(primaryTouchId);
        if (!touch) return;

        const moved = Math.hypot(touch.clientX - startClient.x, touch.clientY - startClient.y);
        if (moved > 10) clearLongPress();

        const { normX, normY } = toNorm(touch.clientX, touch.clientY);
        if (longPressTriggered) {
            interaction?.handleMove(normX, normY);
        }

        lastClient = { x: touch.clientX, y: touch.clientY };
    };

    const onTouchEnd = (event) => {
        for (const touch of event.changedTouches) {
            activeTouches.delete(touch.identifier);
        }
        clearLongPress();

        if (activeTouches.size === 0) {
            const duration = Math.max(1, performance.now() - startTime);
            const dx = lastClient.x - startClient.x;
            const dy = lastClient.y - startClient.y;
            const distance = Math.hypot(dx, dy);
            const speed = distance / duration;

            if (longPressTriggered) {
                interaction?.handleUp();
            } else if (!orbitActive && canInteract()) {
                const { normX, normY } = toNorm(startClient.x, startClient.y);
                const onDie = isHoveringOverDice(camera, normX, normY);

                if (!longPressTriggered && onDie && distance < 14 && duration < 280) {
                    interaction?.handleDown(normX, normY);
                    interaction?.handleUp();
                } else if (!onDie && distance >= FLICK_MIN_DISTANCE && speed >= FLICK_MIN_SPEED) {
                    applyFlickImpulseToDice(camera, dx / duration, dy / duration, { normOriginX: normX, normOriginY: normY });
                } else if (!onDie && distance < 12 && duration < 250) {
                    onRoll?.();
                }
            }

            orbitActive = false;
            pinchStartDistance = 0;
            primaryTouchId = null;
            longPressTriggered = false;
        } else if (activeTouches.size === 1) {
            orbitActive = false;
            pinchStartDistance = 0;
            const touch = [...activeTouches.values()][0];
            primaryTouchId = touch.identifier;
            startClient = { x: touch.clientX, y: touch.clientY };
            lastClient = { ...startClient };
            startTime = performance.now();
        }
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return {
        enabled: true,
        dispose() {
            clearLongPress();
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
            canvas.removeEventListener('touchcancel', onTouchEnd);
        }
    };
}
