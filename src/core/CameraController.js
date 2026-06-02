import * as THREE from 'three';
import { spawnedDice, readDiceValue, areDiceSettled } from '../dice.js';

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

    // Dice Focus Logic
    let diceFocusState = DiceFocusState.IDLE;
    let focusTimer = 0;
    const savedCameraState = { position: new THREE.Vector3(), rotation: new THREE.Euler() };
    const focusTargetPosition = new THREE.Vector3();
    const focusStartPos = new THREE.Vector3();
    const focusStartRot = new THREE.Quaternion();
    const focusEndRot = new THREE.Quaternion();
    let focusProgress = 0;

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

    function update(deltaTime, time, { keys, cursorPos, isLocked, showResults, hideResults, lampData, LampMode }) {
        // Dice Focus State Machine
        if (diceFocusState === DiceFocusState.WAITING_FOR_STOP) {
            if (checkDiceStability(lampData, LampMode)) {
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

                // Read settled dice values and show result overlay
                const results = spawnedDice.map(d => ({
                    type: d.type,
                    value: readDiceValue(d)
                }));
                showResults(results);
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

        // Only allow player control if IDLE
        if (diceFocusState === DiceFocusState.IDLE) {
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

            // Ground collision
            // 6.0 is the standing eye height relative to the floor.
            // (Floor Y = -9.5, Table Y = -3.0. Standing height ~15.5 units above floor -> -9.5 + 15.5 = 6.0)
            if (camera.position.y <= 6.0) {
                camera.position.y = 6.0;
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
        get yaw() { return yaw; },
        get pitch() { return pitch; }
    };
}
