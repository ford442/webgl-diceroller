import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { createConvexHullShape, spawnDicePhysics, getAmmo } from './physics.js';
import {
    getWasmEngine, isWasmAvailable, isWasmInitialized,
    loadHullForDie, pollCollisionEvents, seedPhysicsRNG, randomPhysicsFloat
} from './wasm/WasmPhysicsBridge.js';
import { TABLE_SURFACE_Y } from './core/SceneMetrics.js';

// ---------------------------------------------------------------------------
// Face-detection helpers
// ---------------------------------------------------------------------------

/**
 * Compute unique face normals by clustering per-triangle geometric normals.
 * Works with both indexed and non-indexed BufferGeometry.
 */
function _computeFaceNormals(geometry) {
    const CLUSTER_THRESHOLD = 0.98; // ~11.5° tolerance — tight enough for all die types
    const faceNormals = [];

    const pos = geometry.attributes.position;
    const index = geometry.index;

    const _a = new THREE.Vector3();
    const _b = new THREE.Vector3();
    const _c = new THREE.Vector3();
    const _e1 = new THREE.Vector3();
    const _e2 = new THREE.Vector3();
    const _n  = new THREE.Vector3();

    const getVertex = (i) => {
        const vi = index ? index.getX(i) : i;
        return { x: pos.getX(vi), y: pos.getY(vi), z: pos.getZ(vi) };
    };

    const triCount = index ? index.count / 3 : pos.count / 3;

    for (let t = 0; t < triCount; t++) {
        const va = getVertex(t * 3);
        const vb = getVertex(t * 3 + 1);
        const vc = getVertex(t * 3 + 2);

        _a.set(va.x, va.y, va.z);
        _b.set(vb.x, vb.y, vb.z);
        _c.set(vc.x, vc.y, vc.z);

        _e1.subVectors(_b, _a);
        _e2.subVectors(_c, _a);
        _n.crossVectors(_e1, _e2);

        if (_n.lengthSq() < 1e-10) continue; // skip degenerate triangles
        _n.normalize();

        // Check against existing clusters
        let found = false;
        for (const fn of faceNormals) {
            if (fn.dot(_n) > CLUSTER_THRESHOLD) {
                found = true;
                break;
            }
        }
        if (!found) faceNormals.push(_n.clone());
    }

    return faceNormals;
}

/**
 * Assign integer values 1..N to face normals.
 *
 * Assumes the Blender source models are exported with the +Y axis pointing up,
 * i.e. after the `rotateX(-Math.PI / 2)` applied in loadDiceModels the face
 * that was originally "up" in Blender (the highest-value face) ends up with
 * the most positive Y normal component.  Sorting ascending therefore maps
 * lowest-Y normal → value 1 (face resting on the table) and highest-Y normal
 * → value N (face visible to the player).
 *
 * If values appear reversed for a particular model, flip the sort order here.
 */
function _assignFaceValues(faceNormals) {
    const n = faceNormals.length;
    if (n === 0) return [];

    // Sort ascending by Y: lowest Y → value 1, highest Y → value N
    const sorted = faceNormals
        .map((fn, i) => ({ i, y: fn.y }))
        .sort((a, b) => a.y - b.y);

    const values = new Array(n);
    for (let i = 0; i < n; i++) {
        values[sorted[i].i] = i + 1;
    }
    return values;
}

// Reusable objects for readDiceValue() — avoids per-call heap allocations
const _invQ    = new THREE.Quaternion();
const _localUp = new THREE.Vector3();

/**
 * Read the face-up value for a settled die.
 * Returns null if face-normal data is not available.
 */
export const readDiceValue = (die) => {
    const model = diceModels[die.type];
    if (!model) return null;

    const faceNormals = model.userData.faceNormals;
    const faceValues  = model.userData.faceValues;
    if (!faceNormals || !faceNormals.length || !faceValues) return null;

    // Transform world UP into the die's local space via inverse quaternion
    _invQ.copy(die.mesh.quaternion).invert();
    _localUp.set(0, 1, 0).applyQuaternion(_invQ);

    // The face whose local normal is most aligned with local-up is facing up
    let maxDot  = -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < faceNormals.length; i++) {
        const d = faceNormals[i].dot(_localUp);
        if (d > maxDot) { maxDot = d; bestIdx = i; }
    }

    return faceValues[bestIdx];
};

export const areDiceSettled = () => {
    if (spawnedDice.length === 0) return true;

    if (isWasmAvailable()) {
        return getWasmEngine().areAllSettled();
    }

    let allStable = true;
    spawnedDice.forEach((die) => {
        if (!die.body) return;
        const linear = die.body.getLinearVelocity();
        const angular = die.body.getAngularVelocity();
        const velSq = linear.x() * linear.x() + linear.y() * linear.y() + linear.z() * linear.z();
        const angSq = angular.x() * angular.x() + angular.y() * angular.y() + angular.z() * angular.z();
        if (velSq > 1.0 || angSq > 1.0) allStable = false;
    });

    return allStable;
};

// glTF + Draco loader. The Draco decoder (wasm) is self-hosted under
// public/draco/ so loading works offline and without a CDN round-trip.
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

let diceModels = {};
export let spawnedDice = [];
const WASM_TRANSFORM_STRIDE = 7;

// Helper for Crypto Randomness
const getSecureRandom = () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
};

// Exported for main.js to use during sequential loading
export const diceTypes = [
    { type: 'd4', file: 'dice/die_4.glb' },
    { type: 'd6', file: 'dice/die_6.glb' },
    { type: 'd8', file: 'dice/die_8.glb' },
    { type: 'd10', file: 'dice/die_10.glb' },
    { type: 'd12', file: 'dice/die_12.glb' },
    { type: 'd20', file: 'dice/die_20.glb' }
];

// Export diceModels so main.js can populate it
export { diceModels };

const getDieSides = (type) => Number.parseInt(type.replace('d', ''), 10) || 6;
const isUsingWasmPhysics = () => isWasmInitialized() && isWasmAvailable();

const findSpawnedDieByMesh = (mesh) => spawnedDice.find((die) => die.mesh === mesh) || null;

const getAmmoTransform = (die) => {
    const body = die?.body;
    if (!body || !body.getMotionState()) return null;

    const Ammo = getAmmo();
    if (!_sharedTransform) {
        _sharedTransform = new Ammo.btTransform();
    }

    body.getMotionState().getWorldTransform(_sharedTransform);
    return _sharedTransform;
};

const syncBodyTransformFromMesh = (die, resetVelocities = true) => {
    if (!die?.body) return;

    const Ammo = getAmmo();
    const transform = new Ammo.btTransform();
    transform.setIdentity();
    const origin = new Ammo.btVector3(die.mesh.position.x, die.mesh.position.y, die.mesh.position.z);
    const rotation = new Ammo.btQuaternion(
        die.mesh.quaternion.x,
        die.mesh.quaternion.y,
        die.mesh.quaternion.z,
        die.mesh.quaternion.w
    );
    transform.setOrigin(origin);
    transform.setRotation(rotation);
    die.body.setWorldTransform(transform);
    die.body.getMotionState().setWorldTransform(transform);

    if (resetVelocities) {
        const zeroVec = new Ammo.btVector3(0, 0, 0);
        die.body.setLinearVelocity(zeroVec);
        die.body.setAngularVelocity(zeroVec);
        Ammo.destroy(zeroVec);
    }

    die.body.activate();

    Ammo.destroy(rotation);
    Ammo.destroy(origin);
    Ammo.destroy(transform);
};

const syncWasmTransformForDie = (die, options = {}) => {
    if (!isUsingWasmPhysics() || die?.wasmId == null) return;

    const {
        position = die.mesh.position,
        quaternion = die.mesh.quaternion,
        linearVelocity = null,
        angularVelocity = null
    } = options;

    const engine = getWasmEngine();
    engine.setDieTransform(
        die.wasmId,
        position.x, position.y, position.z,
        quaternion.x, quaternion.y, quaternion.z, quaternion.w
    );

    if (linearVelocity || angularVelocity) {
        engine.setDieVelocity(
            die.wasmId,
            linearVelocity?.x ?? 0,
            linearVelocity?.y ?? 0,
            linearVelocity?.z ?? 0,
            angularVelocity?.x ?? 0,
            angularVelocity?.y ?? 0,
            angularVelocity?.z ?? 0
        );
    }
};

const syncDieStateFromAmmoToWasm = (die) => {
    if (!isUsingWasmPhysics() || die?.wasmId == null || !die.body) return;

    const transform = getAmmoTransform(die);
    if (!transform) return;

    const origin = transform.getOrigin();
    const rotation = transform.getRotation();
    const linear = die.body.getLinearVelocity();
    const angular = die.body.getAngularVelocity();

    syncWasmTransformForDie(die, {
        position: { x: origin.x(), y: origin.y(), z: origin.z() },
        quaternion: { x: rotation.x(), y: rotation.y(), z: rotation.z(), w: rotation.w() },
        linearVelocity: { x: linear.x(), y: linear.y(), z: linear.z() },
        angularVelocity: { x: angular.x(), y: angular.y(), z: angular.z() }
    });
};

export const loadDiceModels = async (onProgress) => {
    let done = 0;
    const total = diceTypes.length;

    const report = (label) => {
        if (typeof onProgress === 'function') onProgress(done, total, label);
    };

    // Load all dice models in parallel for ~4x faster loading on decent connections.
    // The `done` counter is incremented atomically (JS single-threaded) so the
    // percentage reported to the progress bar is accurate, though the per-model
    // label may arrive in any completion order.
    await Promise.all(diceTypes.map(d => new Promise((resolve) => {
        let timedOut = false;
        const url = `./images/${d.file}`;
        const timer = setTimeout(() => {
            console.warn(`Timeout loading ${url}`);
            timedOut = true;
            done++;
            report(d.type);
            resolve();
        }, 15000);

        loader.load(url, (gltf) => {
            if (timedOut) return;
            clearTimeout(timer);

            let mesh = null;
            gltf.scene.traverse((child) => {
                if (child.isMesh) mesh = child;
            });

            if (mesh) {
                const geometry = mesh.geometry.clone();
                geometry.center();
                mesh.updateMatrixWorld(true);
                geometry.applyMatrix4(mesh.matrixWorld);
                geometry.rotateX(-Math.PI / 2);
                geometry.center();

                let material = mesh.material;
                const upgradeMaterial = (mat) => new THREE.MeshStandardMaterial({
                    color: mat.color || 0xeeeeee,
                    map: mat.map || null,
                    roughnessMap: mat.roughnessMap || null,
                    normalMap: mat.normalMap || null,
                    aoMap: mat.aoMap || null,
                    roughness: mat.roughnessMap ? 1.0 : 0.2,
                    metalness: 0.0,
                    envMapIntensity: 1.0
                });

                // Ensure colour maps decode in sRGB (glTF base-colour textures).
                if (mesh.material) {
                    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                    mats.forEach((m) => { if (m.map) m.map.colorSpace = THREE.SRGBColorSpace; });
                }

                if (material) {
                    material = Array.isArray(material) ? material.map(upgradeMaterial) : upgradeMaterial(material);
                } else {
                    console.warn(`No material found for ${d.file}, using default material`);
                    material = new THREE.MeshStandardMaterial({ color: 0xff00ff, roughness: 0.2, metalness: 0.0 });
                }

                const cleanMesh = new THREE.Mesh(geometry, material);
                cleanMesh.position.set(0, 0, 0);
                cleanMesh.rotation.set(0, 0, 0);
                cleanMesh.scale.set(1, 1, 1);

                cleanMesh.castShadow = true;
                cleanMesh.receiveShadow = true;
                cleanMesh.userData.physicsShape = createConvexHullShape(cleanMesh);

                // Precompute face normals and value map for result reading
                const faceNormals = _computeFaceNormals(cleanMesh.geometry);
                cleanMesh.userData.faceNormals = faceNormals;
                cleanMesh.userData.faceValues  = _assignFaceValues(faceNormals);
                diceModels[d.type] = cleanMesh;
            }

            done++;
            report(d.type);
            resolve();
        }, undefined, (error) => {
            if (timedOut) return;
            clearTimeout(timer);
            console.warn(`Error loading ${url}:`, error);
            done++;
            report(d.type);
            resolve();
        });
    })));

    console.log("All dice models loaded");
};

export const spawnObjects = (scene, world, config = null) => {
    // If config is an object (counts), flatten it.
    // If it's a list (array of strings), use it directly.
    let diceToSpawn = [];
    if (config && !Array.isArray(config)) {
        Object.keys(config).forEach(type => {
            const count = config[type];
            for (let i = 0; i < count; i++) diceToSpawn.push(type);
        });
    } else if (Array.isArray(config)) {
        diceToSpawn = config;
    } else {
        // Default
        diceToSpawn = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    }

    diceToSpawn.forEach((type, index) => {
        const template = diceModels[type];
        if (!template) return;

        const mesh = template.clone();

        // Lower spawn height (was 5 + index) to reduce "drop hardness"
        const x = (getSecureRandom() - 0.5) * 4;
        const y = TABLE_SURFACE_Y + 5.75 + (index * 0.5) + (getSecureRandom() * 1);
        const z = (getSecureRandom() - 0.5) * 4;

        mesh.position.set(x, y, z);
        mesh.rotation.set(getSecureRandom() * Math.PI, getSecureRandom() * Math.PI, getSecureRandom() * Math.PI);

        scene.add(mesh);

        const body = spawnDicePhysics(world, mesh, template.userData.physicsShape, {x, y, z}, mesh.rotation);
        mesh.userData.body = body;
        mesh.userData.physicsAuthority = isUsingWasmPhysics() ? 'wasm' : 'ammo';

        let wasmId = null;
        if (isUsingWasmPhysics()) {
            const engine = getWasmEngine();
            const sides = getDieSides(type);
            wasmId = engine.addDie(sides, x, y, z);
            loadHullForDie(wasmId, sides);
            engine.setDieTransform(
                wasmId,
                mesh.position.x, mesh.position.y, mesh.position.z,
                mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w
            );
        }

        // Store type for smart updating
        spawnedDice.push({ mesh, body, type, wasmId });
    });
};

// Reusable transform to avoid per-frame allocations
let _sharedTransform = null;

export const updateDiceVisuals = () => {
    if (isUsingWasmPhysics()) {
        const transforms = getWasmEngine().getTransforms();

        spawnedDice.forEach((die, index) => {
            if (die.mesh.userData.physicsAuthority === 'ammo') {
                const transform = getAmmoTransform(die);
                if (!transform) return;
                const origin = transform.getOrigin();
                const rotation = transform.getRotation();
                die.mesh.position.set(origin.x(), origin.y(), origin.z());
                die.mesh.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
                return;
            }

            const offset = index * WASM_TRANSFORM_STRIDE;
            if (offset + (WASM_TRANSFORM_STRIDE - 1) >= transforms.length) return;

            die.mesh.position.set(
                transforms[offset + 0],
                transforms[offset + 1],
                transforms[offset + 2]
            );
            die.mesh.quaternion.set(
                transforms[offset + 3],
                transforms[offset + 4],
                transforms[offset + 5],
                transforms[offset + 6]
            );
        });

        return;
    }

    spawnedDice.forEach((die) => {
        const transform = getAmmoTransform(die);
        if (!transform) return;
        const origin = transform.getOrigin();
        const rotation = transform.getRotation();
        die.mesh.position.set(origin.x(), origin.y(), origin.z());
        die.mesh.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
    });
};

export const clearDice = (scene, world) => {
    const Ammo = getAmmo();
    const engine = isUsingWasmPhysics() ? getWasmEngine() : null;
    spawnedDice.forEach(die => {
        scene.remove(die.mesh);
        if (die.mesh.geometry) die.mesh.geometry.dispose();
        const mats = Array.isArray(die.mesh.material) ? die.mesh.material : [die.mesh.material];
        mats.forEach(m => m && m.dispose());
        world.removeRigidBody(die.body);
        Ammo.destroy(die.body.getMotionState());
        Ammo.destroy(die.body);
        if (engine && die.wasmId != null) engine.removeDie(die.wasmId);
    });
    spawnedDice = [];
};

export const updateDiceSet = (scene, world, targetCounts) => {
    if (!targetCounts || typeof targetCounts !== 'object') return;

    // 1. Count current dice
    const currentCounts = {};
    spawnedDice.forEach(d => {
        currentCounts[d.type] = (currentCounts[d.type] || 0) + 1;
    });

    // 2. Calculate Difference
    Object.keys(targetCounts).forEach(type => {
        const target = targetCounts[type];
        const current = currentCounts[type] || 0;
        const diff = target - current;

        if (diff > 0) {
            // Add 'diff' amount of this type
            const toAdd = [];
            for(let i=0; i<diff; i++) toAdd.push(type);
            spawnObjects(scene, world, toAdd);
        } else if (diff < 0) {
            // Remove 'abs(diff)' amount of this type
            const Ammo = getAmmo();
            let toRemove = Math.abs(diff);
            // Iterate backwards to safely remove
            for (let i = spawnedDice.length - 1; i >= 0; i--) {
                if (toRemove === 0) break;
                if (spawnedDice[i].type === type) {
                    const die = spawnedDice[i];
                    // Remove physics and free Ammo heap objects
                    world.removeRigidBody(die.body);
                    Ammo.destroy(die.body.getMotionState());
                    Ammo.destroy(die.body);
                    if (isUsingWasmPhysics() && die.wasmId != null) {
                        getWasmEngine().removeDie(die.wasmId);
                    }
                    // Remove visual and free Three.js resources
                    scene.remove(die.mesh);
                    if (die.mesh.geometry) die.mesh.geometry.dispose();
                    const mats = Array.isArray(die.mesh.material) ? die.mesh.material : [die.mesh.material];
                    mats.forEach(m => m && m.dispose());
                    // Remove from array
                    spawnedDice.splice(i, 1);
                    toRemove--;
                }
            }
        }
    });
};

export const throwDice = (scene, world, seed = null) => {
    const Ammo = getAmmo();
    const transform = new Ammo.btTransform();
    const engine = isUsingWasmPhysics() ? getWasmEngine() : null;

    const useDeterministic = seed !== null && isUsingWasmPhysics();
    if (useDeterministic) {
        seedPhysicsRNG(seed);
    }
    const rand = () => useDeterministic ? randomPhysicsFloat() : getSecureRandom();

    spawnedDice.forEach((die, index) => {
        const body = die.body;
        die.mesh.userData.physicsAuthority = engine ? 'wasm' : 'ammo';

        // Reset velocity — use temps destroyed immediately after
        const zeroVec = new Ammo.btVector3(0, 0, 0);
        body.setLinearVelocity(zeroVec);
        body.setAngularVelocity(zeroVec);
        Ammo.destroy(zeroVec);

        // Group them near the top center for the throw
        const x = (rand() - 0.5) * 4;
        const y = TABLE_SURFACE_Y + 6.75 + (index * 0.5);
        const z = (rand() - 0.5) * 4;

        transform.setIdentity();
        const origin = new Ammo.btVector3(x, y, z);
        transform.setOrigin(origin);
        Ammo.destroy(origin);

        // Random starting orientation
        const q = new THREE.Quaternion();
        q.setFromEuler(new THREE.Euler(
            rand() * Math.PI * 2,
            rand() * Math.PI * 2,
            rand() * Math.PI * 2
        ));
        const btQ = new Ammo.btQuaternion(q.x, q.y, q.z, q.w);
        transform.setRotation(btQ);
        Ammo.destroy(btQ);

        body.setWorldTransform(transform);
        body.getMotionState().setWorldTransform(transform);

        // Wake up
        body.activate();

        if (engine && die.wasmId != null) {
            engine.setDieTransform(
                die.wasmId,
                x, y, z,
                q.x, q.y, q.z, q.w
            );
            engine.setDieVelocity(die.wasmId, 0, 0, 0, 0, 0, 0);
        }

        // Throw forces
        const forceX = (rand() - 0.5) * 25;
        const forceY = (rand()) * 10 - 5;
        const forceZ = (rand() - 0.5) * 25;

        const spinX = (rand() - 0.5) * 100;
        const spinY = (rand() - 0.5) * 100;
        const spinZ = (rand() - 0.5) * 100;

        const impulse = new Ammo.btVector3(forceX, forceY, forceZ);
        body.applyCentralImpulse(impulse);
        Ammo.destroy(impulse);

        const torque = new Ammo.btVector3(spinX, spinY, spinZ);
        body.applyTorqueImpulse(torque);
        Ammo.destroy(torque);

        if (engine && die.wasmId != null) {
            engine.applyImpulse(die.wasmId, forceX, forceY, forceZ);
            engine.applyTorqueImpulse(die.wasmId, spinX, spinY, spinZ);
        }
    });

    Ammo.destroy(transform);
};

export const setDiePhysicsAuthority = (mesh, authority) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!die) return;
    die.mesh.userData.physicsAuthority = authority;
};

export const prepareDieForAmmoInteraction = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!die?.body) return;
    syncBodyTransformFromMesh(die, true);
    die.mesh.userData.physicsAuthority = 'ammo';
};

export const syncDieBodyStateToWasm = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!die) return;
    syncDieStateFromAmmoToWasm(die);
};

export const syncDieMeshStateToWasm = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!die) return;
    syncWasmTransformForDie(die);
};

export const applyWasmImpulseForDie = (mesh, impulse, torque) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;

    const engine = getWasmEngine();
    if (impulse) {
        engine.applyImpulse(die.wasmId, impulse.x, impulse.y, impulse.z);
    }
    if (torque) {
        engine.applyTorqueImpulse(die.wasmId, torque.x, torque.y, torque.z);
    }
};

export const syncAllDiceToWasm = () => {
    if (!isUsingWasmPhysics()) return;

    const engine = getWasmEngine();
    engine.clearAllDice();

    spawnedDice.forEach((die) => {
        const sides = getDieSides(die.type);
        die.wasmId = engine.addDie(
            sides,
            die.mesh.position.x,
            die.mesh.position.y,
            die.mesh.position.z
        );
        loadHullForDie(die.wasmId, sides);

        engine.setDieTransform(
            die.wasmId,
            die.mesh.position.x,
            die.mesh.position.y,
            die.mesh.position.z,
            die.mesh.quaternion.x,
            die.mesh.quaternion.y,
            die.mesh.quaternion.z,
            die.mesh.quaternion.w
        );

        if (die.mesh.userData.physicsAuthority !== 'ammo') {
            die.mesh.userData.physicsAuthority = 'wasm';
        }
    });
};

export const pollPhysicsCollisionEvents = () => pollCollisionEvents();
