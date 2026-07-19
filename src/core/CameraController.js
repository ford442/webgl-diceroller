import * as THREE from 'three';
import { spawnedDice, readDiceValue, areDiceSettled, updateDiceVisuals } from '../dice.js';
import { shouldDeferAutoResults } from '../roll/RollSession.js';
import { prefersReducedMotion } from './AccessibilityPrefs.js';
import { CAMERA_EYE_Y, CAMERA_LOOK_AT_Y, CAMERA_START_Z } from './SceneMetrics.js';

const DiceFocusState = {
    IDLE: 'IDLE',
    WAITING_FOR_STOP: 'WAITING_FOR_STOP',
    FOCUSING: 'FOCUSING',
    HOLDING: 'HOLDING',
    RETURNING: 'RETURNING'
};

export { DiceFocusState };

export function createCameraController(camera) {
    const velocity = new THREE.Vector3();
    let isOnGround = true;
    const moveSpeed = 5; // Units per second
    const jumpForce = 8;
    const gravity = -20; // Downward acceleration

    // Camera Control Variables
    let yaw = 0;
    let pitch = 0;
    const maxPitch = Math.PI / 2 - 0.1;
    const minOrbitDistance = 12;
    const maxOrbitDistance = 36;
    const orbitLookAt = new THREE.Vector3(0, CAMERA_LOOK_AT_Y, 0);
    let orbitDistance = CAMERA_START_Z;
    let touchOrbitActive = false;

    // Dice Focus Logic
    let diceFocusState = DiceFocusState.IDLE;
    let focusTimer = 0;
    const savedCameraState = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    const focusTargetPosition = new THREE.Vector3();
    const focusStartPos = new THREE.Vector3();
    const focusStartRot = new THREE.Quaternion();
    const focusEndRot = new THREE.Quaternion();
    let focusProgress = 0;

    function syncOrbitFromCamera() {
        const offset = camera.position.clone().sub(orbitLookAt);
        orbitDistance = Math.max(minOrbitDistance, Math.min(maxOrbitDistance, offset.length()));
        yaw = Math.atan2(offset.x, offset.z);
        const horiz = Math.hypot(offset.x, offset.z);
        pitch = Math.atan2(offset.y, horiz);
    }

    function applyOrbitPose() {
        const horiz = orbitDistance * Math.cos(pitch);
        camera.position.set(
            orbitLookAt.x + horiz * Math.sin(yaw),
            orbitLookAt.y + orbitDistance * Math.sin(pitch),
            orbitLookAt.z + horiz * Math.cos(yaw)
        );
        camera.lookAt(orbitLookAt);
        pitch = camera.rotation.x;
        yaw = camera.rotation.y;
    }

    function applyTouchOrbit(deltaYaw, deltaPitch) {
        if (diceFocusState !== DiceFocusState.IDLE) return;
        touchOrbitActive = true;
        yaw += deltaYaw;
        pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch + deltaPitch));
        applyOrbitPose();
    }

    function applyTouchZoom(scale) {
        if (diceFocusState !== DiceFocusState.IDLE) return;
        touchOrbitActive = true;
        orbitDistance = Math.max(minOrbitDistance, Math.min(maxOrbitDistance, orbitDistance * scale));
        applyOrbitPose();
    }

    function reframeDefaultDistance(startZ) {
        orbitDistance = startZ;
        if (diceFocusState === DiceFocusState.IDLE && !touchOrbitActive) {
            camera.position.set(0, CAMERA_EYE_Y, startZ);
            camera.lookAt(orbitLookAt);
            yaw = camera.rotation.y;
            pitch = camera.rotation.x;
        }
    }

    function getState() {
        return diceFocusState;
    }

    function setState(newState) {
        diceFocusState = newState;
    }

    function checkDiceStability(lampData, LampMode) {
        if (spawnedDice.length === 0) return true;
        const allStable = areDiceSettled();

        // Update lamp rolling state when dice stop
        if (allStable && lampData && lampData.getMode() === LampMode.NORMAL) {
            lampData.setRolling(false);
        }

        return allStable;
    }

    function finishRollResults(showResults, onResultsReady) {
        updateDiceVisuals();
        const results = spawnedDice.map(d => ({
            type: d.type,
            value: readDiceValue(d)
        }));
        if (!shouldDeferAutoResults()) {
            showResults(results);
        }
        onResultsReady?.(results);
    }

    function update(deltaTime, time, {
        keys,
        cursorPos,
        isLocked,
        showResults,
        hideResults,
        lampData,
        LampMode,
        onResultsReady,
        touchPrimary = false
    }) {
        // Dice Focus State Machine
        if (diceFocusState === DiceFocusState.WAITING_FOR_STOP) {
            if (checkDiceStability(lampData, LampMode)) {
                if (prefersReducedMotion()) {
                    // Skip camera fly-to / hold / return; announce results immediately.
                    finishRollResults(showResults, onResultsReady);
                    diceFocusState = DiceFocusState.IDLE;
                    return;
                }

                diceFocusState = DiceFocusState.FOCUSING;

                // Save current state
                savedCameraState.position.copy(camera.position);
                savedCameraState.rotation.copy(camera.rotation);

                // Calculate center
                const center = new THREE.Vector3();
                spawnedDice.forEach(d => center.add(d.mesh.position));
                if (spawnedDice.length > 0) center.divideScalar(spawnedDice.length);

                // Calculate Spread (Standard Deviation-ish) to determine camera distance
                let maxDist = 0;
                spawnedDice.forEach(d => {
                    const dist = d.mesh.position.distanceTo(center);
                    if (dist > maxDist) maxDist = dist;
                });

                // Dynamic camera offset:
                // Higher (y) and further back (z) if dice are spread out.
                // Base offset (0, 8, 4) + spread factor
                const zoomOut = Math.max(1, maxDist * 0.8);
                focusTargetPosition.copy(center).add(new THREE.Vector3(0, 8 + zoomOut, 4 + zoomOut));

                // Setup Tween
                focusStartPos.copy(camera.position);
                focusStartRot.setFromEuler(camera.rotation);

                // Calculate look rotation
                const dummyCam = camera.clone();
                dummyCam.position.copy(focusTargetPosition);
                dummyCam.lookAt(center);
                focusEndRot.copy(dummyCam.quaternion);

                focusProgress = 0;
            }
        } else if (diceFocusState === DiceFocusState.FOCUSING) {
            focusProgress += deltaTime * 2.0; // 0.5s transition
            if (focusProgress > 1) focusProgress = 1;

            // Slerp/Lerp
            camera.position.lerpVectors(focusStartPos, focusTargetPosition, focusProgress);
            camera.quaternion.slerpQuaternions(focusStartRot, focusEndRot, focusProgress);

            if (focusProgress === 1) {
                diceFocusState = DiceFocusState.HOLDING;
                focusTimer = 2.0; // Hold for 2s
                finishRollResults(showResults, onResultsReady);
            }
        } else if (diceFocusState === DiceFocusState.HOLDING) {
            focusTimer -= deltaTime;
            if (focusTimer <= 0) {
                diceFocusState = DiceFocusState.RETURNING;
                focusStartPos.copy(camera.position);
                focusStartRot.copy(camera.quaternion);

                focusTargetPosition.copy(savedCameraState.position);
                const dummyCam = camera.clone();
                dummyCam.rotation.copy(savedCameraState.rotation); // Euler to Quat
                focusEndRot.copy(dummyCam.quaternion);

                focusProgress = 0;
            }
        } else if (diceFocusState === DiceFocusState.RETURNING) {
            focusProgress += deltaTime * 2.0;
            if (focusProgress > 1) focusProgress = 1;

            camera.position.lerpVectors(focusStartPos, focusTargetPosition, focusProgress);
            camera.quaternion.slerpQuaternions(focusStartRot, focusEndRot, focusProgress);

            if (focusProgress === 1) {
                diceFocusState = DiceFocusState.IDLE;
                // Restore exact Euler to prevent gimbal issues or drift
                camera.rotation.copy(savedCameraState.rotation);
                // Sync pitch/yaw vars
                pitch = camera.rotation.x;
                yaw = camera.rotation.y;
            }
        }

        // Only allow desktop FPS control when IDLE and not on a touch-primary device.
        if (diceFocusState === DiceFocusState.IDLE && !touchPrimary && !touchOrbitActive) {
            // FPS Camera Logic - direct mouse-to-rotation mapping
            const turnSensitivity = 0.002; // Mouse sensitivity

            if (isLocked) {
                // Apply accumulated mouse movement directly to rotation
                // Mouse X controls yaw (left/right), Mouse Y controls pitch (up/down)
                yaw -= cursorPos.x * turnSensitivity;
                pitch -= cursorPos.y * turnSensitivity;

                // Reset cursor position since we've consumed the movement
                cursorPos.set(0, 0);

                // Clamp pitch to prevent flipping
                pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
            }

            // Movement logic
            const direction = new THREE.Vector3();
            if (keys['KeyW']) direction.z -= 1; // Back (towards camera) -> Forward
            if (keys['KeyS']) direction.z += 1; // Forward (away from camera) -> Backward
            if (keys['KeyA']) direction.x -= 1; // Left
            if (keys['KeyD']) direction.x += 1; // Right
            if (keys['Space'] && isOnGround) {
                velocity.y = jumpForce;
                isOnGround = false;
            }

            // Normalize direction and apply to velocity
            if (direction.length() > 0) {
                direction.normalize();
                // Rotate direction by camera yaw for forward/back relative to view
                direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
                velocity.x = direction.x * moveSpeed;
                velocity.z = direction.z * moveSpeed;
            } else {
                velocity.x = 0;
                velocity.z = 0;
            }

            // Apply gravity
            velocity.y += gravity * deltaTime;

            // Update position
            camera.position.add(velocity.clone().multiplyScalar(deltaTime));

            // Ground collision at standing eye height.
            if (camera.position.y <= CAMERA_EYE_Y) {
                camera.position.y = CAMERA_EYE_Y;
                velocity.y = 0;
                isOnGround = true;
            }

            // Optional: Simple bounds to stay in room (adjust based on your room size)
            camera.position.x = Math.max(-18, Math.min(18, camera.position.x));
            camera.position.z = Math.max(-18, Math.min(18, camera.position.z));

            // Update camera rotation
            camera.rotation.set(pitch, yaw, 0, 'YXZ');
        }
    }

    return {
        getState,
        setState,
        update,
        applyTouchOrbit,
        applyTouchZoom,
        reframeDefaultDistance,
        get yaw() { return yaw; },
        get pitch() { return pitch; }
    };
}
