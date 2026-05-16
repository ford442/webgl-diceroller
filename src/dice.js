import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { createConvexHullShape, spawnDicePhysics, getAmmo } from './physics.js';

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
 * Strategy: sort normals by Y component ascending so the face whose normal
 * points most downward (resting on the table) gets value 1, and the face
 * whose normal points most upward (showing to the player) gets value N.
 * This matches the standard convention for Western polyhedral dice where the
 * highest-value face is on top when the die is at rest showing its maximum.
 *
 * NOTE: The exact mapping depends on how the source Blender models are
 * oriented. If values appear reversed, flip the sort to descending.
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
    const invQ    = die.mesh.quaternion.clone().invert();
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(invQ);

    // The face whose local normal is most aligned with local-up is facing up
    let maxDot  = -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < faceNormals.length; i++) {
        const d = faceNormals[i].dot(localUp);
        if (d > maxDot) { maxDot = d; bestIdx = i; }
    }

    return faceValues[bestIdx];
};

const loader = new ColladaLoader();

let diceModels = {};
export let spawnedDice = [];

// Helper for Crypto Randomness
const getSecureRandom = () => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
};

// Exported for main.js to use during sequential loading
export const diceTypes = [
    { type: 'd4', file: 'die_4.dae' },
    { type: 'd6', file: 'die_6.dae' },
    { type: 'd8', file: 'die_8.dae' },
    { type: 'd10', file: 'die_10.dae' },
    { type: 'd12', file: 'die_12.dae' },
    { type: 'd20', file: 'die_20.dae' }
];

// Export diceModels so main.js can populate it
export { diceModels };

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

        loader.load(url, (collada) => {
            if (timedOut) return;
            clearTimeout(timer);

            let mesh = null;
            collada.scene.traverse((child) => {
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
                    roughness: 0.2,
                    metalness: 0.0,
                    envMapIntensity: 1.0
                });

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

                diceModels[d.type] = cleanMesh;
                cleanMesh.castShadow = true;
                cleanMesh.receiveShadow = true;
                diceModels[d.type].userData.physicsShape = createConvexHullShape(cleanMesh);

                // Precompute face normals and value map for result reading
                const faceNormals = _computeFaceNormals(cleanMesh.geometry);
                diceModels[d.type].userData.faceNormals = faceNormals;
                diceModels[d.type].userData.faceValues  = _assignFaceValues(faceNormals);
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
        const y = 3 + (index * 0.5) + (getSecureRandom() * 1);
        const z = (getSecureRandom() - 0.5) * 4;

        mesh.position.set(x, y, z);
        mesh.rotation.set(getSecureRandom() * Math.PI, getSecureRandom() * Math.PI, getSecureRandom() * Math.PI);

        scene.add(mesh);

        const body = spawnDicePhysics(world, mesh, template.userData.physicsShape, {x, y, z}, mesh.rotation);
        mesh.userData.body = body;

        // Store type for smart updating
        spawnedDice.push({ mesh, body, type });
    });
};

// Reusable transform to avoid per-frame allocations
let _sharedTransform = null;

export const updateDiceVisuals = () => {
    const Ammo = getAmmo();
    
    // Lazy-init shared transform
    if (!_sharedTransform) {
        _sharedTransform = new Ammo.btTransform();
    }

    spawnedDice.forEach(die => {
        const body = die.body;
        const mesh = die.mesh;

        if (body && body.getMotionState()) {
            body.getMotionState().getWorldTransform(_sharedTransform);
            const origin = _sharedTransform.getOrigin();
            const rotation = _sharedTransform.getRotation();

            mesh.position.set(origin.x(), origin.y(), origin.z());
            mesh.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
        }
    });
};

export const clearDice = (scene, world) => {
    const Ammo = getAmmo();
    spawnedDice.forEach(die => {
        scene.remove(die.mesh);
        if (die.mesh.geometry) die.mesh.geometry.dispose();
        const mats = Array.isArray(die.mesh.material) ? die.mesh.material : [die.mesh.material];
        mats.forEach(m => m && m.dispose());
        world.removeRigidBody(die.body);
        Ammo.destroy(die.body.getMotionState());
        Ammo.destroy(die.body);
    });
    spawnedDice = [];
};

export const updateDiceSet = (scene, world, targetCounts) => {
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

export const throwDice = (scene, world) => {
    const Ammo = getAmmo();
    const transform = new Ammo.btTransform();

    spawnedDice.forEach((die, index) => {
        const body = die.body;

        // Reset velocity — use temps destroyed immediately after
        const zeroVec = new Ammo.btVector3(0, 0, 0);
        body.setLinearVelocity(zeroVec);
        body.setAngularVelocity(zeroVec);
        Ammo.destroy(zeroVec);

        // Group them near the top center for the throw
        // Reduced spread
        const x = (getSecureRandom() - 0.5) * 4;
        const y = 4 + (index * 0.5); // Lower start height
        const z = (getSecureRandom() - 0.5) * 4;

        transform.setIdentity();
        const origin = new Ammo.btVector3(x, y, z);
        transform.setOrigin(origin);
        Ammo.destroy(origin);

        // Random starting orientation
        const q = new THREE.Quaternion();
        q.setFromEuler(new THREE.Euler(
            getSecureRandom() * Math.PI * 2,
            getSecureRandom() * Math.PI * 2,
            getSecureRandom() * Math.PI * 2
        ));
        const btQ = new Ammo.btQuaternion(q.x, q.y, q.z, q.w);
        transform.setRotation(btQ);
        Ammo.destroy(btQ);

        body.setWorldTransform(transform);
        body.getMotionState().setWorldTransform(transform);

        // Wake up
        body.activate();

        // Much softer throw forces
        const forceX = (getSecureRandom() - 0.5) * 25; // Was 80
        const forceY = (getSecureRandom()) * 10 - 5;   // Gentle vertical toss
        const forceZ = (getSecureRandom() - 0.5) * 25; // Was 80

        const spinX = (getSecureRandom() - 0.5) * 100; // Was 350
        const spinY = (getSecureRandom() - 0.5) * 100; // Was 350
        const spinZ = (getSecureRandom() - 0.5) * 100; // Was 350

        const impulse = new Ammo.btVector3(forceX, forceY, forceZ);
        body.applyCentralImpulse(impulse);
        Ammo.destroy(impulse);

        const torque = new Ammo.btVector3(spinX, spinY, spinZ);
        body.applyTorqueImpulse(torque);
        Ammo.destroy(torque);
    });

    Ammo.destroy(transform);
};
