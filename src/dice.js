// @ts-nocheck — not yet part of the incremental checkJs rollout (issue #192); pulled in transitively via interaction.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
    createConvexHullShape,
    spawnDicePhysics,
    getAmmo,
    isAmmoAvailable,
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
    const faceClusters = [];

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

    // Some dice models (die_4/die_8/die_20) carry a handful of corrupted
    // triangles from a bad weld/quantize pass in the asset pipeline — long
    // "spike" edges connecting distant, unrelated vertices. Left in, these
    // can out-rank a real face by summed area and hijack a principal-normal
    // slot in `_selectPrincipalFaceNormals`, pointing readDiceValue at empty
    // space instead of a face. Reject any triangle whose longest edge is a
    // large fraction of the die's own diameter — legitimate face/engraving
    // edges never approach that size.
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const maxEdge = (geometry.boundingSphere?.radius ?? 1) * 0.6;
    const maxEdgeSq = maxEdge * maxEdge;

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
        if (_e1.lengthSq() > maxEdgeSq || _e2.lengthSq() > maxEdgeSq || _b.distanceToSquared(_c) > maxEdgeSq) continue;
        const area = _n.length() * 0.5;
        _n.normalize();

        // Check against existing clusters. Accumulate by area so broad die
        // faces dominate bevels and engraved-number side walls.
        let cluster = null;
        for (const existing of faceClusters) {
            if (existing.normal.dot(_n) > CLUSTER_THRESHOLD) {
                cluster = existing;
                break;
            }
        }
        if (!cluster) {
            cluster = {
                normal: _n.clone(),
                sum: new THREE.Vector3(),
                area: 0
            };
            faceClusters.push(cluster);
        }
        cluster.sum.addScaledVector(_n, area);
        cluster.area += area;
    }

    return faceClusters.map((cluster) => {
        const normal = cluster.sum.lengthSq() > 1e-10
            ? cluster.sum.clone().normalize()
            : cluster.normal.clone();
        normal.userData = { area: cluster.area };
        return normal;
    });
}

/**
 * Reduce many clustered normals (bevels/rounds on the mesh) down to the
 * `sides` principal face directions.
 */
function _selectPrincipalFaceNormals(allNormals, sides) {
    if (!allNormals.length) return [];
    if (allNormals.length <= sides) return allNormals.map((n) => n.clone());

    const selected = [];

    // Prefer high-area planes. The old farthest-point pass used abs(dot),
    // which treated opposite faces as duplicates and could choose bevels.
    const byArea = allNormals
        .slice()
        .sort((a, b) => (b.userData?.area ?? 0) - (a.userData?.area ?? 0));

    for (const normal of byArea) {
        if (selected.length >= sides) break;
        if (selected.every((existing) => existing.dot(normal) < 0.92)) {
            selected.push(normal.clone());
        }
    }

    // Fallback for odd meshes: keep filling with unique directions.
    for (const normal of byArea) {
        if (selected.length >= sides) break;
        if (!selected.some((existing) => existing.dot(normal) > 0.98)) {
            selected.push(normal.clone());
        }
    }

    return selected;
}

const FACE_VALUE_NORMAL_MAPS = {
    // This model prints 3 numbers per face (each face omits the value at its
    // own "apex" vertex). `value` here is the *omitted* number — the one
    // that reads correctly when this face is face-down on the table, which
    // is what readDiceValue's useBottomFace branch looks up.
    d4: [
        { normal: [0, -0.335, -0.942], value: 3 },
        { normal: [0.817, -0.334, 0.471], value: 4 },
        { normal: [-0.816, -0.333, 0.471], value: 1 },
        { normal: [0, 1, 0], value: 2 }
    ],
    d6: [
        { normal: [0, 1, 0], value: 1 },
        { normal: [0, 0, 1], value: 2 },
        { normal: [-1, 0, 0], value: 3 },
        { normal: [1, 0, 0], value: 4 },
        { normal: [0, 0, -1], value: 5 },
        { normal: [0, -1, 0], value: 6 }
    ],
    d8: [
        { normal: [0.816, -0.333, 0.471], value: 8 },
        { normal: [-0.816, 0.333, -0.471], value: 3 },
        { normal: [0.816, 0.333, -0.471], value: 7 },
        { normal: [-0.816, -0.333, 0.471], value: 2 },
        { normal: [0, 1, 0], value: 6 },
        { normal: [0, -1, 0], value: 1 },
        { normal: [0, -0.333, -0.943], value: 4 },
        { normal: [0, 0.333, 0.943], value: 5 }
    ],
    // Printed "0" face maps to value 10 (this app has no separate d100/d%
    // mode, so a straight 1-10 roll is the only sensible reading).
    d10: [
        { normal: [0.771, -0.056, -0.634], value: 6 },
        { normal: [-0.054, -0.056, -0.997], value: 2 },
        { normal: [0, 1, 0], value: 10 },
        { normal: [-0.533, 0.596, -0.601], value: 8 },
        { normal: [0.803, 0.596, -0.014], value: 4 },
        { normal: [0.531, -0.597, 0.602], value: 1 },
        { normal: [0, -1, 0], value: 9 },
        { normal: [-0.771, 0.056, 0.634], value: 3 },
        { normal: [-0.802, -0.597, 0.015], value: 5 },
        { normal: [0.053, 0.056, 0.997], value: 7 }
    ],
    d12: [
        { normal: [0.632, -0.447, -0.632], value: 1 },
        { normal: [0.883, 0.447, -0.140], value: 2 },
        { normal: [0.140, 0.447, -0.883], value: 3 },
        { normal: [-0.406, -0.447, -0.797], value: 4 },
        { normal: [0, -1, 0], value: 5 },
        { normal: [-0.140, -0.447, 0.883], value: 6 },
        { normal: [-0.632, 0.447, 0.632], value: 7 },
        { normal: [0.406, 0.447, 0.797], value: 8 },
        { normal: [0.797, -0.447, 0.406], value: 9 },
        { normal: [-0.883, -0.447, 0.140], value: 10 },
        { normal: [-0.797, 0.447, -0.406], value: 11 },
        { normal: [0, 1, 0], value: 12 }
    ],
    d20: [
        { normal: [0.111, 0.745, 0.658], value: 1 },
        { normal: [-0.512, -0.746, 0.426], value: 2 },
        { normal: [-0.942, -0.334, 0.030], value: 3 },
        { normal: [0.497, -0.334, 0.801], value: 4 },
        { normal: [0.624, -0.746, 0.232], value: 5 },
        { normal: [-0.900, 0.333, 0.282], value: 6 },
        { normal: [0, -1, 0], value: 7 },
        { normal: [-0.206, -0.333, 0.920], value: 8 },
        { normal: [-0.444, 0.331, 0.832], value: 9 },
        { normal: [0.694, 0.333, 0.638], value: 10 },
        { normal: [-0.693, -0.333, -0.639], value: 11 },
        { normal: [0.513, 0.745, -0.425], value: 12 },
        { normal: [0, 1, 0], value: 13 },
        { normal: [0.445, -0.333, -0.831], value: 14 },
        { normal: [0.900, -0.333, -0.282], value: 15 },
        { normal: [-0.498, 0.333, -0.801], value: 16 },
        { normal: [0.942, 0.333, -0.031], value: 17 },
        { normal: [0.206, 0.334, -0.920], value: 18 },
        { normal: [-0.625, 0.745, -0.232], value: 19 },
        { normal: [-0.111, -0.746, -0.656], value: 20 }
    ]
};

/**
 * Assign integer values 1..N to face normals.
 *
 * Prefer source-model maps where the model numbering has been verified. Fall
 * back to the old Y-sort convention for dice without an explicit map.
 */
function _assignFaceValues(faceNormals, type = null) {
    const n = faceNormals.length;
    if (n === 0) return [];

    const mappedNormals = FACE_VALUE_NORMAL_MAPS[type];
    if (mappedNormals?.length === n) {
        const assigned = faceNormals.map((faceNormal) => {
            let best = null;
            let bestDot = -Infinity;
            for (const entry of mappedNormals) {
                const normal = new THREE.Vector3(...entry.normal).normalize();
                const dot = faceNormal.dot(normal);
                if (dot > bestDot) {
                    bestDot = dot;
                    best = entry;
                }
            }
            return bestDot > 0.92 ? best.value : null;
        });

        if (assigned.every((value) => value !== null) && new Set(assigned).size === n) {
            return assigned;
        }
        console.warn(`[DiceReader] Explicit face map did not match ${type}; using Y-sort fallback`, assigned);
    }

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

    // d4 values are printed around the top vertex; selecting the bottom face
    // and using the source-model map yields that visible vertex value.
    // All other dice use the face pointing up.
    const useBottomFace = die.type === 'd4';
    let bestDot = useBottomFace ? Infinity : -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < faceNormals.length; i++) {
        const d = faceNormals[i].dot(_localUp);
        if (useBottomFace) {
            if (d < bestDot) { bestDot = d; bestIdx = i; }
        } else if (d > bestDot) {
            bestDot = d;
            bestIdx = i;
        }
    }

    return faceValues[bestIdx];
};

/** Read current values for every spawned die (for the live HUD). */
export const readAllDiceValues = () => spawnedDice.map((die) => ({
    type: die.type,
    value: readDiceValue(die)
}));

export const getDiceValueDebugSnapshot = () => spawnedDice.map((die) => {
    const model = diceModels[die.type];
    const faceNormals = model?.userData?.faceNormals ?? [];
    const faceValues = model?.userData?.faceValues ?? [];
    const value = readDiceValue(die);
    const dieQuaternion = getDieQuaternion(die);

    _invQ.copy(dieQuaternion).invert();
    _localUp.set(0, 1, 0).applyQuaternion(_invQ);

    const useBottomFace = die.type === 'd4';
    let bestDot = useBottomFace ? Infinity : -Infinity;
    let bestIdx = -1;
    for (let i = 0; i < faceNormals.length; i++) {
        const dot = faceNormals[i].dot(_localUp);
        if ((useBottomFace && dot < bestDot) || (!useBottomFace && dot > bestDot)) {
            bestDot = dot;
            bestIdx = i;
        }
    }

    return {
        type: die.type,
        value,
        selectedFaceIndex: bestIdx,
        selectedFaceValue: bestIdx >= 0 ? faceValues[bestIdx] : null,
        selectedDot: bestDot,
        localUp: { x: _localUp.x, y: _localUp.y, z: _localUp.z },
        faceMap: faceNormals.map((normal, index) => ({
            index,
            value: faceValues[index],
            normal: { x: normal.x, y: normal.y, z: normal.z }
        }))
    };
});

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

// Object pool of Three.js dice meshes, keyed by type. Spawning a die reuses a
// pooled mesh instead of cloning a fresh one, and removing a die returns its
// mesh here instead of disposing it. Pooled meshes share the (single) template
// geometry + material per type, so we never dispose those during gameplay —
// which also avoids freeing a GPU buffer still referenced by other live dice.
const diceMeshPool = {};

function acquireDiceMesh(type) {
    const pool = diceMeshPool[type];
    if (pool && pool.length > 0) {
        const mesh = pool.pop();
        mesh.visible = true;
        return mesh;
    }
    const template = diceModels[type];
    return template ? template.clone() : null;
}

function releaseDiceMesh(scene, type, mesh) {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.userData.body = null;
    (diceMeshPool[type] ??= []).push(mesh);
}
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
/** Ammo rigid bodies for dice are only needed on the fallback/validation paths. */
const needsAmmoDiceBodies = () =>
    !isUsingWasmPhysics()
    || searchParams.has('dual-physics')
    || searchParams.has('ammo-drag');

const ensureDicePhysicsShape = (template) => {
    if (!template?.userData) return null;
    if (template.userData.physicsShape) return template.userData.physicsShape;
    if (!isAmmoAvailable()) return null;
    template.userData.physicsShape = createConvexHullShape(template);
    return template.userData.physicsShape;
};

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

export const findSpawnedDieByMesh = (mesh) => spawnedDice.find((die) => die.mesh === mesh) || null;

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
                // Convex hull for ammo.js is created lazily when a dice body is
                // actually spawned (fallback / dual-physics / ?ammo-drag paths).
                cleanMesh.userData.physicsShape = null;
                cleanMesh.geometry.computeBoundingBox();

                // Precompute principal face normals and value map for result reading.
                // Rounded dice meshes cluster into dozens of bevel normals — keep only
                // the N principal directions that match the die's actual faces.
                const sides = getDieSides(d.type);
                const allNormals = _computeFaceNormals(cleanMesh.geometry);
                const faceNormals = _selectPrincipalFaceNormals(allNormals, sides);
                cleanMesh.userData.faceNormals = faceNormals;
                cleanMesh.userData.faceValues  = _assignFaceValues(faceNormals, d.type);
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

        const mesh = acquireDiceMesh(type);

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

        let body = null;
        if (needsAmmoDiceBodies() && world) {
            const collisionShape = ensureDicePhysicsShape(template);
            body = spawnDicePhysics(
                world,
                mesh,
                collisionShape,
                { x, y, z },
                mesh.rotation,
                {
                    ...physicsPreset,
                    centerOfMassOffset
                }
            );
        }

        mesh.userData.body = body;
        mesh.userData.isDie = true;
        mesh.userData.physicsAuthority = isUsingWasmPhysics() ? 'wasm' : 'ammo';
        mesh.userData.physicsPreset = physicsPreset;
        const audioBodyId = nextAudioBodyId++;
        const inertiaScalar = estimateInertiaScalar(template.geometry, physicsPreset.mass);
        if (body) {
            registerBodyAudioMeta(body, {
                id: audioBodyId,
                type,
                mass: physicsPreset.mass,
                inertiaScalar,
                surface: 'die'
            });
            registerBodyDragMeta(body, {
                dragFactor: physicsPreset.dragFactor ?? 0
            });
        }

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
    const Ammo = isAmmoAvailable() ? getAmmo() : null;
    const engine = isUsingWasmPhysics() ? getWasmEngine() : null;
    spawnedDice.forEach(die => {
        releaseDiceMesh(scene, die.type, die.mesh);
        if (world && die.body) {
            world.removeRigidBody(die.body);
            unregisterBodyAudioMeta(die.body);
            unregisterBodyDragMeta(die.body);
            if (Ammo) destroyAmmoDieBody(Ammo, die.body);
        }
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
            const Ammo = isAmmoAvailable() ? getAmmo() : null;
            let toRemove = Math.abs(diff);
            for (let i = spawnedDice.length - 1; i >= 0; i--) {
                if (toRemove === 0) break;
                if (spawnedDice[i].type === type) {
                    const die = spawnedDice[i];
                    if (world && die.body) {
                        world.removeRigidBody(die.body);
                        unregisterBodyAudioMeta(die.body);
                        unregisterBodyDragMeta(die.body);
                        if (Ammo) destroyAmmoDieBody(Ammo, die.body);
                    }
                    if (isUsingWasmPhysics() && die.wasmId != null) {
                        getWasmEngine().removeDie(die.wasmId);
                    }
                    releaseDiceMesh(scene, die.type, die.mesh);
                    spawnedDice.splice(i, 1);
                    toRemove--;
                }
            }
        }
    });
};

export const throwDice = (scene, world, seed = null) => {
    const Ammo = isAmmoAvailable() ? getAmmo() : null;
    const transform = Ammo ? new Ammo.btTransform() : null;
    const engine = isUsingWasmPhysics() ? getWasmEngine() : null;

    const useDeterministic = seed !== null && isUsingWasmPhysics();
    if (useDeterministic) {
        seedPhysicsRNG(seed);
    }
    const rand = () => useDeterministic ? randomPhysicsFloat() : getSecureRandom();

    spawnedDice.forEach((die, index) => {
        const body = die.body;
        die.mesh.userData.physicsAuthority = engine ? 'wasm' : 'ammo';

        if (body && Ammo) {
            const zeroVec = new Ammo.btVector3(0, 0, 0);
            body.setLinearVelocity(zeroVec);
            body.setAngularVelocity(zeroVec);
            Ammo.destroy(zeroVec);
        }

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

        if (engine && die.wasmId != null) {
            engine.setDieTransform(
                die.wasmId,
                x, y, z,
                q.x, q.y, q.z, q.w
            );
            engine.setDieVelocity(die.wasmId, 0, 0, 0, 0, 0, 0);
        }

        if (body && transform && Ammo) {
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

            body.setWorldTransform(transform);
            body.getMotionState().setWorldTransform(transform);
            body.activate();

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
            return;
        }

        const forceX = (rand() - 0.5) * 25;
        const forceY = (rand()) * 10 - 5;
        const forceZ = (rand() - 0.5) * 25;

        const spinX = (rand() - 0.5) * 100;
        const spinY = (rand() - 0.5) * 100;
        const spinZ = (rand() - 0.5) * 100;

        if (engine && die.wasmId != null) {
            engine.applyImpulse(die.wasmId, forceX, forceY, forceZ);
            engine.applyTorqueImpulse(die.wasmId, spinX, spinY, spinZ);
        }
    });

    if (transform && Ammo) Ammo.destroy(transform);
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

export const setDieWasmKinematic = (mesh, kinematic) => {
    const die = findSpawnedDieByMesh(mesh);
    if (!isUsingWasmPhysics() || !die || die.wasmId == null) return;
    const engine = getWasmEngine();
    if (typeof engine.setDieKinematic === 'function') {
        engine.setDieKinematic(die.wasmId, kinematic);
    }
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
