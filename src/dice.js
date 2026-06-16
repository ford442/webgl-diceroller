import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
    createConvexHullShape,
    spawnDicePhysics,
    getAmmo,
    registerBodyAudioMeta,
    unregisterBodyAudioMeta,
    registerBodyDragMeta,
    unregisterBodyDragMeta
} from './physics.js';
import {
    getWasmEngine, isWasmAvailable, isWasmInitialized,
    loadHullForDie, pollCollisionEvents, seedPhysicsRNG, randomPhysicsFloat
} from './wasm/PhysicsBridge.js';
import { TABLE_SURFACE_Y } from './core/SceneMetrics.js';
const searchParams = new URLSearchParams(window.location.search);
const WASM_TRANSFORM_STRIDE = 7;

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

function _getFaceNormalForValue(faceNormals, faceValues, targetValue) {
    if (!faceNormals || !faceValues) return null;
    const index = faceValues.findIndex((value) => value === targetValue);
    return index >= 0 ? faceNormals[index]?.clone() ?? null : null;
}

// Reusable objects for readDiceValue() — avoids per-call heap allocations
const _invQ    = new THREE.Quaternion();
const _localUp = new THREE.Vector3();
const _readQ   = new THREE.Quaternion();

function getWasmTransformForDie(wasmId) {
    const engine = getWasmEngine();
    if (typeof engine.getDieIds !== 'function') return null;

    const transforms = engine.getTransforms();
    const ids = engine.getDieIds();
    if (!transforms?.length || !ids?.length) return null;

    for (let i = 0; i < ids.length; i++) {
        if (Math.round(ids[i]) !== wasmId) continue;
        const offset = i * WASM_TRANSFORM_STRIDE;
        if (offset + (WASM_TRANSFORM_STRIDE - 1) >= transforms.length) return null;
        return {
            x: transforms[offset + 0],
            y: transforms[offset + 1],
            z: transforms[offset + 2],
            qx: transforms[offset + 3],
            qy: transforms[offset + 4],
            qz: transforms[offset + 5],
            qw: transforms[offset + 6]
        };
    }

    return null;
}

function getDieQuaternion(die) {
    if (die?.mesh?.userData?.physicsAuthority === 'ammo' && die.body) {
        const transform = getAmmoTransform(die);
        if (transform) {
            const rotation = transform.getRotation();
            _readQ.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
            return _readQ;
        }
    }

    if (isUsingWasmPhysics() && die?.wasmId != null) {
        const wasmTransform = getWasmTransformForDie(die.wasmId);
        if (wasmTransform) {
            _readQ.set(wasmTransform.qx, wasmTransform.qy, wasmTransform.qz, wasmTransform.qw);
            return _readQ;
        }
    }

    return die.mesh.quaternion;
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

    const dieQuaternion = getDieQuaternion(die);

    // Transform world UP into the die's local space via inverse quaternion
    _invQ.copy(dieQuaternion).invert();
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

    const wasmDice = spawnedDice.filter(
        (die) => die.wasmId != null && die.mesh.userData.physicsAuthority !== 'ammo'
    );

    if (isUsingWasmPhysics() && wasmDice.length > 0) {
        if (!getWasmEngine().areAllSettled()) return false;
    }

    let allStable = true;
    spawnedDice.forEach((die) => {
        if (die.mesh.userData.physicsAuthority === 'wasm' && die.wasmId != null) return;
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
let nextAudioBodyId = 1;
const DEFAULT_MASS_BIAS_RATIO = 0.0075; // ~0.75% of die height, within the 0.5-1% range

// Pipping bias: lower-number faces have less material removed, so the "1" face
// is the heaviest side. We shift the centre of mass toward that face by a small
// fraction of the die's bounding-box height. `?fair-dice` disables the effect;
// `?bias-ratio=0.01` overrides the default magnitude (clamped to a sane range).
const getMassBiasRatio = () => {
    const raw = searchParams.get('bias-ratio');
    if (raw === null) return DEFAULT_MASS_BIAS_RATIO;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(value, 0.05)) : DEFAULT_MASS_BIAS_RATIO;
};

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
const useMassBias = () => !searchParams.has('fair-dice');

export const PHYSICS_PRESETS = {
    // Per-die-type tuning. dragFactor controls velocity-squared air resistance
    // (larger values stop hard throws faster). Friction/rollingFriction are
    // also tuned so small, pointy dice settle more quickly than big d20s.
    d4: { mass: 5, friction: 0.85, rollingFriction: 0.35, dragFactor: 0.0024 },
    d6: { mass: 5, friction: 0.60, rollingFriction: 0.10, dragFactor: 0.0020 },
    d8: { mass: 5, friction: 0.55, rollingFriction: 0.08, dragFactor: 0.0019 },
    d10: { mass: 5, friction: 0.50, rollingFriction: 0.06, dragFactor: 0.0018 },
    d12: { mass: 5, friction: 0.45, rollingFriction: 0.05, dragFactor: 0.0017 },
    d20: { mass: 5, friction: 0.40, rollingFriction: 0.03, dragFactor: 0.0016 }
};

const findSpawnedDieByMesh = (mesh) => spawnedDice.find((die) => die.mesh === mesh) || null;

function estimateInertiaScalar(geometry, mass) {
    const bbox = geometry.boundingBox ?? geometry.computeBoundingBox?.();
    const source = bbox || geometry.boundingBox;
    if (!source) return 0.4 * mass;

    const size = new THREE.Vector3();
    source.getSize(size);
    const ix = (mass / 12) * (size.y * size.y + size.z * size.z);
    const iy = (mass / 12) * (size.x * size.x + size.z * size.z);
    const iz = (mass / 12) * (size.x * size.x + size.y * size.y);
    return (ix + iy + iz) / 3;
}

function getCenterOfMassOffset(die) {
    const offset = die?.centerOfMassOffset ?? die?.body?._centerOfMassOffset ?? die?.mesh?.userData?.centerOfMassOffset;
    if (!offset) return null;
    return offset;
}

function getGeometryPositionFromBodyTransform(die, origin, quaternion) {
    const offset = getCenterOfMassOffset(die);
    if (!offset) {
        return { x: origin.x(), y: origin.y(), z: origin.z() };
    }

    const worldOffset = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion);
    return {
        x: origin.x() - worldOffset.x,
        y: origin.y() - worldOffset.y,
        z: origin.z() - worldOffset.z
    };
}

function getBodyPositionFromGeometry(position, quaternion, offset) {
    if (!offset) return position;
    const worldOffset = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(quaternion);
    return {
        x: position.x + worldOffset.x,
        y: position.y + worldOffset.y,
        z: position.z + worldOffset.z
    };
}

function destroyAmmoDieBody(Ammo, body) {
    if (!body) return;
    const ownedCollisionShape = body._ownedCollisionShape ?? null;
    const motionState = body.getMotionState?.();
    if (motionState) Ammo.destroy(motionState);
    Ammo.destroy(body);
    if (ownedCollisionShape) Ammo.destroy(ownedCollisionShape);
}

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
    const bodyPosition = getBodyPositionFromGeometry(
        die.mesh.position,
        die.mesh.quaternion,
        getCenterOfMassOffset(die)
    );
    const origin = new Ammo.btVector3(bodyPosition.x, bodyPosition.y, bodyPosition.z);
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
    const quaternion = new THREE.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w());
    const position = getGeometryPositionFromBodyTransform(die, origin, quaternion);

    syncWasmTransformForDie(die, {
        position,
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
                cleanMesh.geometry.computeBoundingBox();

                // Precompute face normals and value map for result reading
                const faceNormals = _computeFaceNormals(cleanMesh.geometry);
                cleanMesh.userData.faceNormals = faceNormals;
                cleanMesh.userData.faceValues  = _assignFaceValues(faceNormals);
                const oneFaceNormal = _getFaceNormalForValue(cleanMesh.userData.faceNormals, cleanMesh.userData.faceValues, 1);
                if (oneFaceNormal && cleanMesh.geometry.boundingBox) {
                    const bboxSize = new THREE.Vector3();
                    cleanMesh.geometry.boundingBox.getSize(bboxSize);
                    const massBiasMagnitude = bboxSize.y * getMassBiasRatio();
                    // Vector points toward the "1" face (heaviest side), shifting
                    // the centre of mass away from the geometric centroid.
                    cleanMesh.userData.massBiasOffset = oneFaceNormal.multiplyScalar(massBiasMagnitude);
                } else {
                    cleanMesh.userData.massBiasOffset = null;
                }
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
        mesh.updateMatrixWorld(true);

        scene.add(mesh);

        const physicsPreset = PHYSICS_PRESETS[type] ?? PHYSICS_PRESETS.d6;
        const centerOfMassOffset = useMassBias()
            ? template.userData.massBiasOffset?.clone() ?? null
            : null;
        const body = spawnDicePhysics(
            world,
            mesh,
            template.userData.physicsShape,
            {x, y, z},
            mesh.rotation,
            {
                ...physicsPreset,
                centerOfMassOffset
            }
        );
        mesh.userData.body = body;
        mesh.userData.physicsAuthority = isUsingWasmPhysics() ? 'wasm' : 'ammo';
        mesh.userData.physicsPreset = physicsPreset;
        const audioBodyId = nextAudioBodyId++;
        const inertiaScalar = estimateInertiaScalar(template.geometry, physicsPreset.mass);
        registerBodyAudioMeta(body, {
            id: audioBodyId,
            type,
            mass: physicsPreset.mass,
            inertiaScalar
        });
        registerBodyDragMeta(body, {
            dragFactor: physicsPreset.dragFactor ?? 0
        });

        let wasmId = null;
        if (isUsingWasmPhysics()) {
            const engine = getWasmEngine();
            const sides = getDieSides(type);
            wasmId = engine.addDie(sides, x, y, z);
            engine.setDieMaterial(wasmId, physicsPreset.friction, physicsPreset.rollingFriction);
            engine.setDieDrag(wasmId, physicsPreset.dragFactor ?? 0);
            loadHullForDie(wasmId, sides);
            engine.setDieTransform(
                wasmId,
                mesh.position.x, mesh.position.y, mesh.position.z,
                mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w
            );
        }

        // Store type for smart updating
        spawnedDice.push({
            mesh,
            body,
            type,
            wasmId,
            physicsPreset,
            audioBodyId,
            inertiaScalar,
            centerOfMassOffset,
            massBiasOffset: template.userData.massBiasOffset?.clone() ?? null
        });
    });
};

// Reusable transform to avoid per-frame allocations
let _sharedTransform = null;

export const updateDiceVisuals = () => {
    if (isUsingWasmPhysics()) {
        const transforms = getWasmEngine().getTransforms();
        const ids = typeof getWasmEngine().getDieIds === 'function'
            ? getWasmEngine().getDieIds()
            : null;

        spawnedDice.forEach((die) => {
            if (die.mesh.userData.physicsAuthority === 'ammo') {
                const transform = getAmmoTransform(die);
                if (!transform) return;
                const origin = transform.getOrigin();
                const rotation = transform.getRotation();
                const quaternion = new THREE.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w());
                const position = getGeometryPositionFromBodyTransform(die, origin, quaternion);
                die.mesh.position.set(position.x, position.y, position.z);
                die.mesh.quaternion.copy(quaternion);
                return;
            }

            if (die.wasmId == null) return;

            let offset = -1;
            if (ids?.length) {
                for (let i = 0; i < ids.length; i++) {
                    if (Math.round(ids[i]) === die.wasmId) {
                        offset = i * WASM_TRANSFORM_STRIDE;
                        break;
                    }
                }
            } else {
                offset = spawnedDice.indexOf(die) * WASM_TRANSFORM_STRIDE;
            }

            if (offset < 0 || offset + (WASM_TRANSFORM_STRIDE - 1) >= transforms.length) return;

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
        const quaternion = new THREE.Quaternion(rotation.x(), rotation.y(), rotation.z(), rotation.w());
        const position = getGeometryPositionFromBodyTransform(die, origin, quaternion);
        die.mesh.position.set(position.x, position.y, position.z);
        die.mesh.quaternion.copy(quaternion);
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
        unregisterBodyAudioMeta(die.body);
        unregisterBodyDragMeta(die.body);
        destroyAmmoDieBody(Ammo, die.body);
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
                    unregisterBodyAudioMeta(die.body);
                    unregisterBodyDragMeta(die.body);
                    destroyAmmoDieBody(Ammo, die.body);
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

        // Random starting orientation
        const q = new THREE.Quaternion();
        q.setFromEuler(new THREE.Euler(
            rand() * Math.PI * 2,
            rand() * Math.PI * 2,
            rand() * Math.PI * 2
        ));

        const bodyPosition = getBodyPositionFromGeometry(
            { x, y, z },
            q,
            getCenterOfMassOffset(die)
        );

        transform.setIdentity();
        const origin = new Ammo.btVector3(bodyPosition.x, bodyPosition.y, bodyPosition.z);
        transform.setOrigin(origin);
        Ammo.destroy(origin);

        const btQ = new Ammo.btQuaternion(q.x, q.y, q.z, q.w);
        transform.setRotation(btQ);
        Ammo.destroy(btQ);

        if (engine && die.wasmId != null) {
            engine.setDieTransform(
                die.wasmId,
                x, y, z,
                q.x, q.y, q.z, q.w
            );
            engine.setDieVelocity(die.wasmId, 0, 0, 0, 0, 0, 0);
        }

        body.setWorldTransform(transform);
        body.getMotionState().setWorldTransform(transform);

        // Wake up
        body.activate();

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

export const applyDiceMassBiases = ({ deltaTime = 1 / 60, applyAmmo = true, applyWasm = true } = {}) => {
    if (!useMassBias()) return;

    const Ammo = applyAmmo ? getAmmo() : null;
    const gravityForce = new THREE.Vector3(0, -15, 0);
    const worldOffset = new THREE.Vector3();
    const torque = new THREE.Vector3();

    spawnedDice.forEach((die) => {
        if (!die.massBiasOffset) return;

        worldOffset.copy(die.massBiasOffset).applyQuaternion(die.mesh.quaternion);
        torque.crossVectors(worldOffset, gravityForce).multiplyScalar(die.physicsPreset?.mass ?? 5);
        if (torque.lengthSq() < 1e-8) return;

        if (applyAmmo && die.body && !getCenterOfMassOffset(die)) {
            const torqueImpulse = new Ammo.btVector3(
                torque.x * deltaTime,
                torque.y * deltaTime,
                torque.z * deltaTime
            );
            die.body.applyTorqueImpulse(torqueImpulse);
            die.body.activate();
            Ammo.destroy(torqueImpulse);
        }

        if (applyWasm && isUsingWasmPhysics() && die.wasmId != null) {
            getWasmEngine().applyTorqueImpulse(
                die.wasmId,
                torque.x * deltaTime,
                torque.y * deltaTime,
                torque.z * deltaTime
            );
        }
    });
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

/**
 * Kinematic / user-driven control primitives for WASM-authoritative
 * interactions (drag & levitation). These let interaction.js hold and move a
 * die entirely inside the WASM world without involving ammo.js.
 */
export const driveDieWasmTransform = (mesh, position, quaternion) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    syncWasmTransformForDie(die, { position, quaternion });
};

export const setDieWasmVelocity = (mesh, linear = null, angular = null) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    getWasmEngine().setDieVelocity(
        die.wasmId,
        linear?.x ?? 0, linear?.y ?? 0, linear?.z ?? 0,
        angular?.x ?? 0, angular?.y ?? 0, angular?.z ?? 0
    );
};

/** Current die position/orientation as tracked by the WASM engine (or null). */
export const getDieWasmTransform = (mesh) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return null;
    return getWasmTransformForDie(die.wasmId);
};

export const syncAllDiceToWasm = () => {
    if (!isUsingWasmPhysics()) return;

    const engine = getWasmEngine();
    engine.clearAllDice();

    spawnedDice.forEach((die) => {
        const sides = getDieSides(die.type);
        const physicsPreset = die.physicsPreset ?? PHYSICS_PRESETS[die.type] ?? PHYSICS_PRESETS.d6;
        die.wasmId = engine.addDie(
            sides,
            die.mesh.position.x,
            die.mesh.position.y,
            die.mesh.position.z
        );
        engine.setDieMaterial(die.wasmId, physicsPreset.friction, physicsPreset.rollingFriction);
        engine.setDieDrag(die.wasmId, physicsPreset.dragFactor ?? 0);
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
