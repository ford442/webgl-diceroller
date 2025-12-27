import Ammo from 'ammo.js';
import * as THREE from 'three';

// Ensure Ammo is loaded
let AmmoInstance = null;

export const initPhysics = async () => {
    // Ammo.js (v0.0.10) export is the Module object, not a factory function.
    // However, we handle both cases for robustness.
    if (typeof Ammo === 'function') {
        try {
            AmmoInstance = await Ammo();
        } catch (e) {
            // Fallback if it's not a promise
            AmmoInstance = Ammo();
        }
    } else {
        AmmoInstance = Ammo;
    }

    // Check for initialization
    if (!AmmoInstance.btVector3) {
        // Sometimes it takes a moment or relies on a callback?
        // But for 0.0.10 asm.js it should be sync.
        console.warn("Ammo.btVector3 is missing. Ammo object:", AmmoInstance);
    }

    const collisionConfiguration = new AmmoInstance.btDefaultCollisionConfiguration();
    const dispatcher = new AmmoInstance.btCollisionDispatcher(collisionConfiguration);
    const overlappingPairCache = new AmmoInstance.btDbvtBroadphase();
    const solver = new AmmoInstance.btSequentialImpulseConstraintSolver();
    const dynamicsWorld = new AmmoInstance.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
    dynamicsWorld.setGravity(new AmmoInstance.btVector3(0, -10, 0));

    return dynamicsWorld;
};

export const getAmmo = () => {
    if (!AmmoInstance) {
        throw new Error("Ammo not initialized. Call initPhysics first.");
    }
    return AmmoInstance;
};

export const stepPhysics = (world, deltaTime) => {
    world.stepSimulation(deltaTime, 10);
};

export const createFloorAndWalls = (scene, world) => {
    // Floor
    createBox(scene, world, 25, 1, 25, 0, -5, 0, 0, 0xffffff, 'images/wood.jpg'); // Using path directly, might need texture loader adjustments

    // Walls
    createBox(scene, world, 1, 100, 25, 13, 45, 0, 0, 0x000000, null, true);
    createBox(scene, world, 1, 100, 25, -13, 45, 0, 0, 0x000000, null, true);
    createBox(scene, world, 25, 100, 1, 0, 45, 13, 0, 0x000000, null, true);
    createBox(scene, world, 25, 100, 1, 0, 45, -13, 0, 0x000000, null, true);
};

const createBox = (scene, world, sx, sy, sz, px, py, pz, mass, color, textureUrl, invisible = false) => {
    // Three.js visual
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

    // Ammo.js physics
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

    world.addRigidBody(body);
};

// Placeholder for spawning dice physics
export const spawnDicePhysics = (world, mesh, collisionShape, position, rotation) => {
    const mass = 15;
    const transform = new AmmoInstance.btTransform();
    transform.setIdentity();
    transform.setOrigin(new AmmoInstance.btVector3(position.x, position.y, position.z));

    const q = new AmmoInstance.btQuaternion();
    q.setEulerZYX(rotation.z, rotation.y, rotation.x);
    transform.setRotation(q);

    const motionState = new AmmoInstance.btDefaultMotionState(transform);
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);
    collisionShape.calculateLocalInertia(mass, localInertia);

    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, collisionShape, localInertia);
    const body = new AmmoInstance.btRigidBody(rbInfo);

    world.addRigidBody(body);

    return body;
};

// Helper to create convex hull shape from mesh
export const createConvexHullShape = (mesh) => {
    const shape = new AmmoInstance.btConvexHullShape();

    // Iterate over vertices
    const geometry = mesh.geometry;
    const positionAttribute = geometry.attributes.position;

    for ( let i = 0; i < positionAttribute.count; i ++ ) {
        const v = new THREE.Vector3();
        v.fromBufferAttribute( positionAttribute, i );
        // Apply scale if any
        v.applyMatrix4(mesh.matrixWorld);

        const vec = new AmmoInstance.btVector3(v.x, v.y, v.z);
        shape.addPoint(vec);
    }

    return shape;
};
