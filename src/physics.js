import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let AmmoInstance = null;
let _ammoLoadPromise = null;
const ammoBodyAudioMeta = new Map();
const ammoCollisionCooldowns = new Map();
const ammoBodyDragMeta = new Map();
const physicsSearchParams = new URLSearchParams(window.location.search);

function getBodyPtr(body) {
    return body?.ptr ?? body?.a ?? null;
}

/**
 * True once ammo.js has been dynamically imported and the dynamics world is
 * ready.  WASM-only sessions never load the ammo chunk.
 */
export const isAmmoAvailable = () => AmmoInstance != null;

async function loadAmmoModule() {
    if (AmmoInstance) return AmmoInstance;
    if (!_ammoLoadPromise) {
        _ammoLoadPromise = (async () => {
            const Ammo = (await import('ammo.js')).default;
            if (typeof Ammo === 'function') {
                try {
                    AmmoInstance = await Ammo();
                } catch {
                    AmmoInstance = Ammo();
                }
            } else {
                AmmoInstance = Ammo;
            }
            if (!AmmoInstance?.btVector3) {
                console.error('Ammo.btVector3 is missing. Ammo object:', AmmoInstance);
            }
            return AmmoInstance;
        })();
    }
    return _ammoLoadPromise;
}

/**
 * Whether this session needs the ammo.js fallback/validation path.
 * Call after `loadWasmEngine()` has resolved.
 */
export function shouldLoadAmmoPhysics(wasmAvailable) {
    if (physicsSearchParams.has('no-wasm')) return true;
    if (!wasmAvailable) return true;
    if (physicsSearchParams.has('dual-physics')) return true;
    if (physicsSearchParams.has('ammo-drag')) return true;
    return false;
}

/**
 * Initialise ammo.js and return a btDiscreteDynamicsWorld, or `null` when the
 * WASM engine is authoritative and no ammo escape hatch is active.
 */
export const initPhysics = async ({ requireAmmo = true } = {}) => {
    if (!requireAmmo) return null;

    await loadAmmoModule();

    const collisionConfiguration = new AmmoInstance.btDefaultCollisionConfiguration();
    const dispatcher = new AmmoInstance.btCollisionDispatcher(collisionConfiguration);
    const overlappingPairCache = new AmmoInstance.btDbvtBroadphase();
    const solver = new AmmoInstance.btSequentialImpulseConstraintSolver();
    const dynamicsWorld = new AmmoInstance.btDiscreteDynamicsWorld(
        dispatcher, overlappingPairCache, solver, collisionConfiguration
    );
    dynamicsWorld.setGravity(new AmmoInstance.btVector3(0, -15, 0));

    return dynamicsWorld;
};

export const getAmmo = () => {
    return AmmoInstance;
};

export const registerBodyAudioMeta = (body, meta) => {
    const ptr = getBodyPtr(body);
    if (ptr == null) return;
    ammoBodyAudioMeta.set(ptr, meta);
};

export const registerBodyDragMeta = (body, meta) => {
    const ptr = getBodyPtr(body);
    if (ptr == null) return;
    ammoBodyDragMeta.set(ptr, meta);
};

export const unregisterBodyAudioMeta = (body) => {
    const ptr = getBodyPtr(body);
    if (ptr == null) return;
    ammoBodyAudioMeta.delete(ptr);
};

export const unregisterBodyDragMeta = (body) => {
    const ptr = getBodyPtr(body);
    if (ptr == null) return;
    ammoBodyDragMeta.delete(ptr);
};

export const stepPhysics = (world, deltaTime) => {
    if (!world || !AmmoInstance) return;
    if (!physicsSearchParams.has('no-drag')) {
        applyAmmoQuadraticDrag(deltaTime);
    }
    world.stepSimulation(deltaTime, 4, 1 / 60);
};

/**
 * Apply velocity-squared air resistance to each registered die.
 */
function applyAmmoQuadraticDrag(deltaTime) {
    if (!AmmoInstance?.wrapPointer) return;

    for (const [ptr, meta] of ammoBodyDragMeta.entries()) {
        if (!meta?.dragFactor) continue;
        const body = AmmoInstance.wrapPointer(ptr, AmmoInstance.btRigidBody);
        if (!body) continue;

        const velocity = body.getLinearVelocity();
        const vx = velocity.x();
        const vy = velocity.y();
        const vz = velocity.z();
        const speedSq = vx * vx + vy * vy + vz * vz;
        if (speedSq < 1e-6) continue;

        const dragScale = meta.dragFactor * speedSq * deltaTime;
        const dragImpulse = new AmmoInstance.btVector3(
            -vx * dragScale,
            -vy * dragScale,
            -vz * dragScale
        );
        body.applyCentralImpulse(dragImpulse);
        body.activate();
        AmmoInstance.destroy(dragImpulse);
    }
}

export const pollAmmoCollisionEvents = (world) => {
    if (!world || !AmmoInstance?.castObject) return [];

    const dispatcher = world.getDispatcher?.();
    if (!dispatcher) return [];

    const manifoldCount = dispatcher.getNumManifolds();
    const now = performance.now();
    const events = [];

    for (let i = 0; i < manifoldCount; i++) {
        const manifold = dispatcher.getManifoldByIndexInternal(i);
        if (!manifold || manifold.getNumContacts() <= 0) continue;

        const bodyA = AmmoInstance.castObject(manifold.getBody0(), AmmoInstance.btRigidBody);
        const bodyB = AmmoInstance.castObject(manifold.getBody1(), AmmoInstance.btRigidBody);
        const metaA = ammoBodyAudioMeta.get(getBodyPtr(bodyA));
        const metaB = ammoBodyAudioMeta.get(getBodyPtr(bodyB));
        if (!metaA && !metaB) continue;

        let maxImpulse = 0;
        for (let c = 0; c < manifold.getNumContacts(); c++) {
            const point = manifold.getContactPoint(c);
            const distance = point.getDistance();
            if (distance > 0) continue;
            maxImpulse = Math.max(maxImpulse, point.getAppliedImpulse?.() ?? 0);
        }
        if (maxImpulse <= 0.02) continue;

        const pickEnergy = (body, meta) => {
            if (!body || !meta) return -1;
            const linear = body.getLinearVelocity();
            const angular = body.getAngularVelocity();
            const linearSpeedSq = linear.x() * linear.x() + linear.y() * linear.y() + linear.z() * linear.z();
            const angularSpeedSq = angular.x() * angular.x() + angular.y() * angular.y() + angular.z() * angular.z();
            return 0.5 * (meta.mass ?? 5) * linearSpeedSq + 0.5 * (meta.inertiaScalar ?? 0) * angularSpeedSq;
        };

        const energyA = pickEnergy(bodyA, metaA);
        const energyB = pickEnergy(bodyB, metaB);
        const sourceMeta = !metaB ? metaA : (!metaA ? metaB : (energyA >= energyB ? metaA : metaB));
        const sourceBody = sourceMeta === metaA ? bodyA : bodyB;
        const otherMeta = sourceMeta === metaA ? metaB : metaA;

        const linear = sourceBody.getLinearVelocity();
        const angular = sourceBody.getAngularVelocity();
        const linearSpeedSq = linear.x() * linear.x() + linear.y() * linear.y() + linear.z() * linear.z();
        const angularSpeedSq = angular.x() * angular.x() + angular.y() * angular.y() + angular.z() * angular.z();
        const impactSpeed = Math.sqrt(maxImpulse / Math.max(sourceMeta?.mass ?? 5, 0.001));
        const collisionKey = `${sourceMeta?.id ?? 'x'}:${otherMeta?.id ?? 'table'}`;
        const lastAt = ammoCollisionCooldowns.get(collisionKey) ?? 0;
        if ((now - lastAt) < 45) continue;
        ammoCollisionCooldowns.set(collisionKey, now);

        events.push({
            idA: sourceMeta?.id ?? -1,
            idB: otherMeta?.id ?? -1,
            impactSpeed,
            mass: sourceMeta?.mass ?? 5,
            inertiaScalar: sourceMeta?.inertiaScalar ?? 0,
            linearSpeedSq,
            angularSpeedSq,
            surface: sourceMeta?.surface ?? 'die',
            otherSurface: otherMeta?.surface ?? (otherMeta ? 'die' : 'table')
        });
    }

    return events;
};

export const createFloorAndWalls = (scene, world, tableConfig = null) => {
    if (!AmmoInstance || !world) return;

    if (tableConfig && tableConfig.physicsBodies) {
        console.log('Physics: Creating floor and walls from explicit physicsBodies config', tableConfig.physicsBodies);
        tableConfig.physicsBodies.forEach(bodyDef => {
            if (bodyDef.type === 'box') {
                createPhysicsBox(
                    world,
                    bodyDef.size.x, bodyDef.size.y, bodyDef.size.z,
                    bodyDef.position.x, bodyDef.position.y, bodyDef.position.z,
                    bodyDef.mass,
                    {
                        friction: bodyDef.friction,
                        restitution: bodyDef.restitution
                    }
                );
            }
        });
        return;
    }

    let floorY = -5;
    let width = 25;
    let depth = 25;
    let thickness = 1;

    if (tableConfig) {
        floorY = tableConfig.position.y;
        width = tableConfig.width;
        depth = tableConfig.depth;
        thickness = tableConfig.height;

        console.log('Physics: Creating floor from config', { floorY, width, depth, thickness });

        const velvetVisualOffset = 0.1;
        console.log(`Creating physics floor at Y=${floorY + velvetVisualOffset} with thickness=${thickness}`);
        createPhysicsBox(world, width, thickness, depth, tableConfig.position.x, floorY + velvetVisualOffset, tableConfig.position.z, 0);
    } else {
        createBox(scene, world, 25, 1, 25, 0, -5, 0, 0, 0xffffff, 'images/wood.jpg');
    }

    let wallHeight = 100;
    let wallThickness = 1;
    let wallOffsetY = 0;

    if (tableConfig && tableConfig.walls) {
        wallHeight = tableConfig.walls.height;
        wallThickness = 20;
        wallOffsetY = tableConfig.walls.offsetY;
    }

    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const wallY = (tableConfig && tableConfig.walls) ? (floorY + wallOffsetY) : (floorY + wallHeight / 2);

    console.log(`Creating physics walls at Y=${wallY} with Height=${wallHeight} Thickness=${wallThickness}`);

    createBox(scene, world, wallThickness, wallHeight, depth, halfWidth + wallThickness/2, wallY, 0, 0, 0x000000, null, true);
    createBox(scene, world, wallThickness, wallHeight, depth, -halfWidth - wallThickness/2, wallY, 0, 0, 0x000000, null, true);

    const topBotWidth = width + 2 * wallThickness;
    createBox(scene, world, topBotWidth, wallHeight, wallThickness, 0, wallY, halfDepth + wallThickness/2, 0, 0x000000, null, true);
    createBox(scene, world, topBotWidth, wallHeight, wallThickness, 0, wallY, -halfDepth - wallThickness/2, 0, 0x000000, null, true);
};

const createPhysicsBox = (world, sx, sy, sz, px, py, pz, mass, options = {}) => {
    const shape = new AmmoInstance.btBoxShape(new AmmoInstance.btVector3(sx * 0.5, sy * 0.5, sz * 0.5));
    const transform = new AmmoInstance.btTransform();
    transform.setIdentity();
    transform.setOrigin(new AmmoInstance.btVector3(px, py, pz));

    const motionState = new AmmoInstance.btDefaultMotionState(transform);
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);

    if (mass > 0) {
        shape.calculateLocalInertia(mass, localInertia);
    }

    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
    const body = new AmmoInstance.btRigidBody(rbInfo);

    const friction = options.friction !== undefined ? options.friction : 0.6;
    const restitution = options.restitution !== undefined ? options.restitution : 0.3;

    body.setFriction(friction);
    body.setRestitution(restitution);

    world.addRigidBody(body);
};

const createBox = (scene, world, sx, sy, sz, px, py, pz, mass, color, textureUrl, invisible = false) => {
    let material;
    if (textureUrl) {
        const texture = new THREE.TextureLoader().load(textureUrl);
        material = new THREE.MeshStandardMaterial({ map: texture });
    } else {
        material = new THREE.MeshStandardMaterial({ color: color });
    }

    if (invisible) {
        material.visible = false;
        material.transparent = true;
        material.opacity = 0;
    }

    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    createPhysicsBox(world, sx, sy, sz, px, py, pz, mass);
};

const DEFAULT_DICE_PHYSICS = {
    mass: 5,
    friction: 0.6,
    rollingFriction: 0.1,
    restitution: 0.2,
    linearDamping: 0.05,
    angularDamping: 0.1
};

export const spawnDicePhysics = (world, mesh, collisionShape, position, rotation, options = {}) => {
    if (!AmmoInstance || !world || !collisionShape) return null;

    const {
        mass = DEFAULT_DICE_PHYSICS.mass,
        friction = DEFAULT_DICE_PHYSICS.friction,
        rollingFriction = DEFAULT_DICE_PHYSICS.rollingFriction,
        restitution = DEFAULT_DICE_PHYSICS.restitution,
        linearDamping = DEFAULT_DICE_PHYSICS.linearDamping,
        angularDamping = DEFAULT_DICE_PHYSICS.angularDamping,
        centerOfMassOffset = null
    } = options;

    collisionShape.setMargin(0.01);

    const threeQuat = new THREE.Quaternion();
    threeQuat.setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));

    const offset = centerOfMassOffset
        ? new THREE.Vector3(centerOfMassOffset.x || 0, centerOfMassOffset.y || 0, centerOfMassOffset.z || 0)
        : null;
    const hasComOffset = !!offset && offset.lengthSq() > 1e-10;
    let bodyShape = collisionShape;
    let ownedCollisionShape = null;

    if (hasComOffset) {
        const childTransform = new AmmoInstance.btTransform();
        childTransform.setIdentity();
        const childOrigin = new AmmoInstance.btVector3(-offset.x, -offset.y, -offset.z);
        childTransform.setOrigin(childOrigin);

        ownedCollisionShape = new AmmoInstance.btCompoundShape();
        ownedCollisionShape.addChildShape(childTransform, collisionShape);
        if (typeof ownedCollisionShape.recalculateLocalAabb === 'function') {
            ownedCollisionShape.recalculateLocalAabb();
        }
        bodyShape = ownedCollisionShape;

        AmmoInstance.destroy(childOrigin);
        AmmoInstance.destroy(childTransform);
    }

    const bodyOrigin = new THREE.Vector3(position.x, position.y, position.z);
    if (hasComOffset) {
        bodyOrigin.add(offset.clone().applyQuaternion(threeQuat));
    }

    const transform = new AmmoInstance.btTransform();
    transform.setIdentity();
    const origin = new AmmoInstance.btVector3(bodyOrigin.x, bodyOrigin.y, bodyOrigin.z);
    transform.setOrigin(origin);

    const q = new AmmoInstance.btQuaternion(threeQuat.x, threeQuat.y, threeQuat.z, threeQuat.w);
    transform.setRotation(q);

    const motionState = new AmmoInstance.btDefaultMotionState(transform);
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);
    bodyShape.calculateLocalInertia(mass, localInertia);

    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, bodyShape, localInertia);
    const body = new AmmoInstance.btRigidBody(rbInfo);
    if (hasComOffset) {
        body._centerOfMassOffset = { x: offset.x, y: offset.y, z: offset.z };
        body._ownedCollisionShape = ownedCollisionShape;
        mesh.userData.centerOfMassOffset = body._centerOfMassOffset;
    } else {
        mesh.userData.centerOfMassOffset = null;
    }

    body.setFriction(friction);
    body.setRollingFriction(rollingFriction);
    body.setRestitution(restitution);
    body.setDamping(linearDamping, angularDamping);
    body.setActivationState(4);

    world.addRigidBody(body);

    AmmoInstance.destroy(rbInfo);
    AmmoInstance.destroy(localInertia);
    AmmoInstance.destroy(origin);
    AmmoInstance.destroy(q);
    AmmoInstance.destroy(transform);

    return body;
};

export const createStaticBody = (world, mesh, shape) => {
    if (!AmmoInstance || !world || !shape) {
        if (mesh) mesh.userData.physicsBody = null;
        return null;
    }

    const mass = 0;
    const transform = new AmmoInstance.btTransform();
    transform.setIdentity();
    transform.setOrigin(new AmmoInstance.btVector3(mesh.position.x, mesh.position.y, mesh.position.z));

    const q = new AmmoInstance.btQuaternion(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
    transform.setRotation(q);

    const motionState = new AmmoInstance.btDefaultMotionState(transform);
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);

    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
    const body = new AmmoInstance.btRigidBody(rbInfo);

    world.addRigidBody(body);
    mesh.userData.physicsBody = body;

    AmmoInstance.destroy(rbInfo);
    AmmoInstance.destroy(localInertia);

    return body;
};

export const createConvexHullShape = (mesh) => {
    if (!AmmoInstance) return null;

    const shape = new AmmoInstance.btConvexHullShape();

    const srcPos = mesh.geometry.attributes.position;
    const originalCount = srcPos.count;

    const posArr = new Float32Array(originalCount * 3);
    for (let i = 0; i < originalCount; i++) {
        posArr[i * 3]     = srcPos.getX(i);
        posArr[i * 3 + 1] = srcPos.getY(i);
        posArr[i * 3 + 2] = srcPos.getZ(i);
    }
    let geometry = mesh.geometry.clone();
    BufferGeometryUtils.deinterleaveGeometry(geometry);
    geometry = BufferGeometryUtils.mergeVertices(geometry);

    const positionAttribute = geometry.attributes.position;
    console.log(`Creating convex hull from ${positionAttribute.count} vertices (original: ${originalCount})`);

    for (let i = 0; i < positionAttribute.count; i++) {
        const v = new THREE.Vector3();
        v.fromBufferAttribute(positionAttribute, i);
        v.applyMatrix4(mesh.matrixWorld);
        const vec = new AmmoInstance.btVector3(v.x, v.y, v.z);
        shape.addPoint(vec);
        AmmoInstance.destroy(vec);
    }
    return shape;
};
