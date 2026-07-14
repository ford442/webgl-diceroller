// @ts-nocheck — not yet part of the incremental checkJs rollout (issue #192); pulled in transitively via PropRegistry.js.
import * as THREE from 'three';
import { getAmmo } from './physics.js';
import { isWasmAvailable, isWasmInitialized } from './wasm/PhysicsBridge.js';
import {
    spawnedDice,
    prepareDieForAmmoInteraction,
    setDiePhysicsAuthority,
    syncDieBodyStateToWasm,
    syncDieMeshStateToWasm,
    applyWasmImpulseForDie,
    driveDieWasmTransform
} from './dice.js';

let raycaster;
let mouse;
let draggedItem = null;
let dragConstraint = null;

// Phase 4: drag + levitation are routed through the WASM world by default
// (kinematic control via setDieTransform/setDieVelocity), which keeps held dice
// authoritative in the physics worker instead of stepping ammo on the main
// thread. `?ammo-drag` opts back into the legacy ammo constraint path; the
// historical `?wasm-drag` flag is now a no-op alias since this is the default.
// When WASM is unavailable we transparently fall back to the ammo path.
const _interactionParams = new URLSearchParams(window.location.search);
const _ammoDragRequested = _interactionParams.has('ammo-drag');
const isWasmInteractionMode = () =>
    !_ammoDragRequested && isWasmInitialized() && isWasmAvailable();

// WASM-authoritative drag state (used only when isWasmInteractionMode()).
let wasmDragActive = false;
const _wasmDragTarget = new THREE.Vector3();
let _wasmDragHasTarget = false;
const MAX_DRAG_SPEED = 60; // clamp so a fast cursor can't fling the die wildly

let lastClickTime = 0;
let lastClickObject = null;
const DOUBLE_CLICK_DELAY = 300;

// Interactive Objects Registry
const interactiveObjects = [];

export const initInteraction = (camera, scene, physicsWorld, hooks = {}) => {
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Pre-warm: force shader compilation for levitation effects
    // This prevents the freeze on first double-click.
    // Use requestAnimationFrame instead of setTimeout to guarantee the renderer
    // has completed at least one frame before we try to compile shaders.
    const warmMaterials = () => {
        if (!scene.userData.renderer) {
            // Renderer not ready yet — retry on the next frame
            requestAnimationFrame(warmMaterials);
            return;
        }
        const warmLight = new THREE.PointLight(0x0088ff, 1, 1);
        const warmGeo = new THREE.SphereGeometry(0.01, 4, 4);
        const warmMat = new THREE.MeshBasicMaterial({ color: 0x0088ff });
        const warmMesh = new THREE.Mesh(warmGeo, warmMat);
        warmMesh.add(warmLight);
        warmMesh.position.set(0, -1000, 0); // Hide far away
        scene.add(warmMesh);
        
        // Force shader/material warmup when the active renderer supports it.
        if (typeof scene.userData.renderer.compile === 'function') {
            scene.userData.renderer.compile(scene, camera);
        }
        
        // Clean up after a few frames
        setTimeout(() => {
            scene.remove(warmMesh);
            warmGeo.dispose();
            warmMat.dispose();
            warmLight.dispose();
        }, 500);
    };
    
    // Kick off on the next animation frame so the renderer is ready
    requestAnimationFrame(warmMaterials);

    return {
        handleDown: (x, y) => onPointerDown(x, y, camera, scene, physicsWorld, hooks),
        handleMove: (x, y) => onPointerMove(x, y, camera),
        handleUp: () => onPointerUp(physicsWorld, hooks)
    };
};

export const registerInteractiveObject = (mesh, callback) => {
    interactiveObjects.push({ mesh, callback });
};

export const unregisterInteractiveObject = (mesh) => {
    const index = interactiveObjects.findIndex((entry) => entry.mesh === mesh);
    if (index >= 0) interactiveObjects.splice(index, 1);
};

function onPointerDown(x, y, camera, scene, physicsWorld, hooks = {}) {
    updateMouse(x, y);
    
    // Configure raycaster for precise dice picking
    raycaster.setFromCamera(mouse, camera);
    raycaster.params.Points.threshold = 0.1;
    raycaster.params.Line.threshold = 0.1;
    
    // 1. Check Interactive Objects (Static props like Lamps)
    if (interactiveObjects.length > 0) {
        const interactiveMeshes = interactiveObjects.map(obj => obj.mesh);
        const intersectsInteractive = raycaster.intersectObjects(interactiveMeshes, true);

        if (intersectsInteractive.length > 0) {
            const hit = intersectsInteractive[0];
            const registered = interactiveObjects.find(io => {
                return io.mesh === hit.object || isDescendant(hit.object, io.mesh);
            });

            if (registered) {
                registered.callback();
                return;
            }
        }
    }

    // 2. Check Physics Objects (Dice) - use recursive to catch all mesh children
    const diceGroups = spawnedDice.map(d => d.mesh);
    const intersects = raycaster.intersectObjects(diceGroups, true);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        let object = intersect.object;
        const point = intersect.point;

        // Traverse up to find the object with physics body (in case we hit a child mesh)
        while (object && !object.userData.body && object.parent) {
            object = object.parent;
        }

        if (object && object.userData.body) {
            const wasmMode = isWasmInteractionMode();
            // In WASM mode the die stays WASM-authoritative; in ammo mode we hand
            // it to ammo for constraint-based dragging.
            if (!wasmMode) prepareDieForAmmoInteraction(object);

            const now = Date.now();
            if (lastClickObject === object && (now - lastClickTime) < DOUBLE_CLICK_DELAY) {
                // Double click detected
                triggerLevitation(object, scene, physicsWorld, hooks);
                lastClickObject = null;
                lastClickTime = 0;
                return;
            }

            lastClickTime = now;
            lastClickObject = object;

            draggedItem = object;
            hooks.onMotionActivityChange?.(true, 'drag');
            if (wasmMode) {
                startWasmDrag(object, point);
            } else {
                startDrag(object.userData.body, point, physicsWorld);
            }
        }
    }
}

function isDescendant(child, parent) {
    let curr = child.parent;
    while (curr) {
        if (curr === parent) return true;
        curr = curr.parent;
    }
    return false;
}

function onPointerMove(x, y, camera) {
    updateMouse(x, y);

    if (!draggedItem) return;

    // Project the cursor onto a camera-parallel plane through the die.
    const target = projectCursorToDiePlane(camera);
    if (!target) return;

    if (wasmDragActive) {
        // Drive happens in the update loop (needs dt); just record the target.
        _wasmDragTarget.copy(target);
        _wasmDragHasTarget = true;
    } else if (dragConstraint) {
        const Ammo = getAmmo();
        // Update constraint pivot B (which is in world space for p2p)
        dragConstraint.setPivotB(new Ammo.btVector3(target.x, target.y, target.z));
    }
}

function projectCursorToDiePlane(camera) {
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane();
    plane.setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        draggedItem.position
    );
    const target = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, target) ? target : null;
}

function onPointerUp(physicsWorld, hooks = {}) {
    if (wasmDragActive) {
        // Release: impart the tracked cursor velocity as an impulse (applyImpulse
        // wakes the body) so a flick tosses the die; otherwise it just drops. The
        // WASM solver takes over from here. Authority is already 'wasm'.
        if (_dragHasPrev && _dragReleaseVel.lengthSq() > 0.0001) {
            applyWasmImpulseForDie(draggedItem, {
                x: _dragReleaseVel.x, y: _dragReleaseVel.y, z: _dragReleaseVel.z
            }, null);
        }
        wasmDragActive = false;
        _wasmDragHasTarget = false;
        _dragHasPrev = false;
        draggedItem = null;
        hooks.onMotionActivityChange?.(false, 'drag');
        return;
    }

    if (dragConstraint) {
        const Ammo = getAmmo();
        syncDieBodyStateToWasm(draggedItem);
        setDiePhysicsAuthority(draggedItem, 'wasm');
        physicsWorld.removeConstraint(dragConstraint);
        Ammo.destroy(dragConstraint);
        dragConstraint = null;
        draggedItem = null;
        hooks.onMotionActivityChange?.(false, 'drag');
    }
}

function updateMouse(x, y) {
    // x and y are assumed to be Normalized Device Coordinates (-1 to +1)
    // passed directly from the main loop which calculates them from the crosshair position
    mouse.x = x;
    mouse.y = y;
}

function startDrag(body, point, physicsWorld) {
    const Ammo = getAmmo();
    const localPointThree = draggedItem.worldToLocal(point.clone());
    const localPivotAmmo = new Ammo.btVector3(localPointThree.x, localPointThree.y, localPointThree.z);

    dragConstraint = new Ammo.btPoint2PointConstraint(body, localPivotAmmo);

    // Make the constraint stronger
    const setting = (typeof dragConstraint.get_m_setting === 'function') ? dragConstraint.get_m_setting() : (dragConstraint.m_setting || null);
    if (setting) {
        if (typeof setting.set_m_impulseClamp === 'function') {
            setting.set_m_impulseClamp(100);
            setting.set_m_tau(0.001);
            setting.set_m_damping(1.0);
        } else {
            setting.m_impulseClamp = 100;
            setting.m_tau = 0.001;
            setting.m_damping = 1.0;
        }
    }

    physicsWorld.addConstraint(dragConstraint);
    body.activate();
}

function startWasmDrag(object, point) {
    // Keep the die WASM-authoritative; hold it kinematically toward the cursor.
    setDiePhysicsAuthority(object, 'wasm');
    wasmDragActive = true;
    _wasmDragHasTarget = true;
    _wasmDragTarget.copy(point);
}

// Reusable scratch vectors for the WASM drag drive (avoid per-frame allocation).
const _dragPrevTarget = new THREE.Vector3();
let _dragHasPrev = false;
const _dragReleaseVel = new THREE.Vector3();

function updateWasmDrag(deltaTime) {
    if (!wasmDragActive || !draggedItem || !_wasmDragHasTarget) return;
    const dt = deltaTime > 0 ? deltaTime : 1 / 60;

    // Track the cursor velocity so releasing the die imparts a natural toss.
    if (_dragHasPrev) {
        _dragReleaseVel.copy(_wasmDragTarget).sub(_dragPrevTarget).divideScalar(dt);
        if (_dragReleaseVel.lengthSq() > MAX_DRAG_SPEED * MAX_DRAG_SPEED) {
            _dragReleaseVel.setLength(MAX_DRAG_SPEED);
        }
    }
    _dragPrevTarget.copy(_wasmDragTarget);
    _dragHasPrev = true;

    // Kinematic hold: place the die at the cursor target each frame, keeping its
    // current orientation. setDieTransform wakes the body and zeroes velocity, so
    // this works reliably against the shipped WASM binary (setDieVelocity alone
    // does not wake a settled die — see the C++ note).
    driveDieWasmTransform(draggedItem, _wasmDragTarget, draggedItem.quaternion);
    draggedItem.position.copy(_wasmDragTarget); // mirror for immediate visuals
}

export const updateInteraction = (deltaTime = 1 / 60) => {
    if (wasmDragActive) {
        updateWasmDrag(deltaTime);
    } else if (draggedItem && draggedItem.userData.body) {
        draggedItem.userData.body.activate();
    }
    updateLevitation(deltaTime);
};

export const isDragging = () => draggedItem !== null;
export const hasActiveDiceInteraction = () => draggedItem !== null || levitatingDice.length > 0;

// True only when an active interaction relies on the ammo.js solver (so the main
// loop must keep stepping ammo). WASM-mode interactions don't need ammo stepping.
export const interactionNeedsAmmoStep = () =>
    !isWasmInteractionMode() && hasActiveDiceInteraction();

export const isHoveringOverDice = (camera, normX, normY) => {
    if (!raycaster) return false;
    mouse.x = normX;
    mouse.y = normY;
    raycaster.setFromCamera(mouse, camera);
    const meshes = spawnedDice.map(d => d.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    return intersects.length > 0;
};

// Get the first die under the cursor (for hover effects)
export const getHoveredDie = (camera, normX, normY) => {
    if (!raycaster) return null;
    mouse.x = normX;
    mouse.y = normY;
    raycaster.setFromCamera(mouse, camera);
    const meshes = spawnedDice.map(d => d.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length > 0) {
        let object = intersects[0].object;
        // Traverse up to find the die group
        while (object && !object.userData.body && object.parent) {
            object = object.parent;
        }
        return object;
    }
    return null;
};

const levitatingDice = [];

function triggerLevitation(object, scene, physicsWorld, hooks = {}) {
    if (levitatingDice.find(d => d.object === object)) return;

    const wasmMode = isWasmInteractionMode();
    const body = object.userData.body;

    if (wasmMode) {
        // WASM-authoritative: drive position/orientation via setDieTransform each
        // frame; no ammo kinematic flags involved. Keep authority 'wasm'.
        setDiePhysicsAuthority(object, 'wasm');
    } else {
        prepareDieForAmmoInteraction(object);
        // Switch to Kinematic so we can control position manually
        body.setCollisionFlags(body.getCollisionFlags() | 2); // CF_KINEMATIC_OBJECT
        body.setActivationState(4); // DISABLE_DEACTIVATION
    }

    // Create Blue Light
    const light = new THREE.PointLight(0x0088ff, 5, 5);
    light.castShadow = true;
    light.shadow.bias = -0.0001;
    light.position.set(0, 0, 0);
    object.add(light);

    levitatingDice.push({
        object: object,
        body: body,
        light: light,
        scene: scene,
        physicsWorld: physicsWorld,
        hooks,
        wasm: wasmMode,
        startTime: Date.now(),
        startX: object.position.x,
        startZ: object.position.z,
        startY: object.position.y,
        targetY: object.position.y + 2.0,
        // Tracked spin orientation for WASM kinematic control.
        spinQuat: object.quaternion.clone(),
        state: 'lifting'
    });

    if (!wasmMode) setDiePhysicsAuthority(object, 'ammo');
    hooks.onMotionActivityChange?.(true, 'levitation');
}

// Per-frame Y-axis spin increment applied during levitation hover.
const _levitationSpinStep = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

// Reusable transform for levitation updates
let _levitationTransform = null;

function updateLevitation() {
    if (levitatingDice.length === 0) return;

    const now = Date.now();
    const Ammo = getAmmo();

    // Lazy-init shared transform (only needed for the ammo path)
    if (!_levitationTransform && Ammo) {
        _levitationTransform = new Ammo.btTransform();
    }

    for (let i = levitatingDice.length - 1; i >= 0; i--) {
        const item = levitatingDice[i];
        const elapsed = (now - item.startTime) / 1000;

        if (elapsed < 1.5) {
            // Lifting (0-0.5s) or Hovering (0.5-1.5s)
            let currentY = item.startY;
            if (elapsed < 0.5) {
                const t = elapsed / 0.5;
                const ease = t * (2 - t); // Ease out quad
                currentY = item.startY + (item.targetY - item.startY) * ease;
            } else {
                currentY = item.targetY;
            }

            if (item.wasm) {
                // Advance tracked spin and drive the WASM transform kinematically.
                // setDieTransform wakes the body and zeroes its velocity each frame,
                // holding it in place without relying on setDieVelocity (which does
                // not wake a settled die against the shipped binary).
                _levitationSpinStep.setFromAxisAngle(_UP, 0.15);
                item.spinQuat.multiply(_levitationSpinStep);
                driveDieWasmTransform(
                    item.object,
                    { x: item.startX, y: currentY, z: item.startZ },
                    item.spinQuat
                );
                // Mirror onto the mesh so the light/visuals track immediately.
                item.object.position.set(item.startX, currentY, item.startZ);
                item.object.quaternion.copy(item.spinQuat);
            } else {
                // Update Mesh Position
                item.object.position.y = currentY;
                // Spin Mesh
                item.object.rotateY(0.15); // Spin speed

                // Sync Body to Mesh
                const p = item.object.position;
                const q = item.object.quaternion;
                _levitationTransform.setIdentity();
                _levitationTransform.setOrigin(new Ammo.btVector3(p.x, p.y, p.z));
                _levitationTransform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));
                item.body.setWorldTransform(_levitationTransform);
                item.body.getMotionState().setWorldTransform(_levitationTransform);
            }

        } else {
            // Release
            if (item.light) {
                item.object.remove(item.light);
                if (item.light.dispose) item.light.dispose();
            }

            // Random Throw — weaker than a normal roll.
            const forceX = (Math.random() - 0.5) * 50;
            const forceY = Math.random() * 20 - 10;
            const forceZ = (Math.random() - 0.5) * 50;

            const spinVal = 300;
            const spinX = (Math.random() - 0.5) * spinVal;
            const spinY = (Math.random() - 0.5) * spinVal;
            const spinZ = (Math.random() - 0.5) * spinVal;

            if (item.wasm) {
                // Hand authority back to the WASM solver with a release throw.
                // applyImpulse/applyTorqueImpulse wake the body and impart motion
                // reliably (unlike setDieVelocity on the shipped binary).
                applyWasmImpulseForDie(
                    item.object,
                    { x: forceX, y: forceY, z: forceZ },
                    { x: spinX, y: spinY, z: spinZ }
                );
                setDiePhysicsAuthority(item.object, 'wasm');
            } else {
                // Reset ammo physics from kinematic back to dynamic.
                item.body.setCollisionFlags(item.body.getCollisionFlags() & ~2); // Remove Kinematic
                item.body.setActivationState(1); // ACTIVE_TAG

                syncDieMeshStateToWasm(item.object);
                applyWasmImpulseForDie(
                    item.object,
                    { x: forceX, y: forceY, z: forceZ },
                    { x: spinX, y: spinY, z: spinZ }
                );
                setDiePhysicsAuthority(item.object, 'wasm');

                item.body.applyCentralImpulse(new Ammo.btVector3(forceX, forceY, forceZ));
                item.body.applyTorqueImpulse(new Ammo.btVector3(spinX, spinY, spinZ));
            }

            item.hooks?.onMotionActivityChange?.(false, 'levitation');
            levitatingDice.splice(i, 1);
        }
    }
}
