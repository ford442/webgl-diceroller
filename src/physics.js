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
        console.warn("Ammo.btVector3 is missing. Ammo object:", AmmoInstance);
    }

    const collisionConfiguration = new AmmoInstance.btDefaultCollisionConfiguration();
    const dispatcher = new AmmoInstance.btCollisionDispatcher(collisionConfiguration);
    const overlappingPairCache = new AmmoInstance.btDbvtBroadphase();
    const solver = new AmmoInstance.btSequentialImpulseConstraintSolver();
    const dynamicsWorld = new AmmoInstance.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
    dynamicsWorld.setGravity(new AmmoInstance.btVector3(0, -20, 0)); // Increased gravity for heavier feel

    return dynamicsWorld;
};

export const getAmmo = () => {
    if (!AmmoInstance) {
        throw new Error("Ammo not initialized. Call initPhysics first.");
    }
    return AmmoInstance;
};

export const stepPhysics = (world, deltaTime) => {
    // Higher sub-steps for better accuracy with fast moving dice
    world.stepSimulation(deltaTime, 10, 1/60);
};

export const createFloorAndWalls = (scene, world, tableConfig = null) => {
    // Floor
    let floorY = -5;
    let width = 25;
    let depth = 25;
    let thickness = 1;

    if (tableConfig) {
        // Use table config for floor physics
        floorY = tableConfig.position.y;
        width = tableConfig.width;
        depth = tableConfig.depth;
        thickness = tableConfig.height;

        // Visuals are already created by Table.js, so we only need physics for the floor
        createPhysicsBox(world, width, thickness, depth, tableConfig.position.x, floorY, tableConfig.position.z, 0);
    } else {
        // Fallback or legacy floor
        createBox(scene, world, 25, 1, 25, 0, -5, 0, 0, 0xffffff, 'images/wood.jpg');
    }

    // Walls - Adjusted based on floor size
    const wallHeight = 100;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    const wallY = floorY + wallHeight / 2;

    createBox(scene, world, 1, wallHeight, depth, halfWidth + 0.5, wallY, 0, 0, 0x000000, null, true);
    createBox(scene, world, 1, wallHeight, depth, -halfWidth - 0.5, wallY, 0, 0, 0x000000, null, true);
    createBox(scene, world, width, wallHeight, 1, 0, wallY, halfDepth + 0.5, 0, 0x000000, null, true);
    createBox(scene, world, width, wallHeight, 1, 0, wallY, -halfDepth - 0.5, 0, 0x000000, null, true);
};

const createPhysicsBox = (world, sx, sy, sz, px, py, pz, mass) => {
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

    // Floor properties
    body.setFriction(0.6);
    body.setRestitution(0.5); // Bouncy floor

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

// Spawn Dice with tuned physics
export const spawnDicePhysics = (world, mesh, collisionShape, position, rotation) => {
    const mass = 5; // Lower mass works better with higher gravity for responsiveness

    // TIGHTEN MARGINS: This prevents "floating" and balancing on edges
    collisionShape.setMargin(0.01);

    const transform = new AmmoInstance.btTransform();
    transform.setIdentity();
    transform.setOrigin(new AmmoInstance.btVector3(position.x, position.y, position.z));

    const threeQuat = new THREE.Quaternion();
    threeQuat.setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
    
    const q = new AmmoInstance.btQuaternion(threeQuat.x, threeQuat.y, threeQuat.z, threeQuat.w);
    transform.setRotation(q);

    const motionState = new AmmoInstance.btDefaultMotionState(transform);
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);
    collisionShape.calculateLocalInertia(mass, localInertia);

    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, collisionShape, localInertia);
    const body = new AmmoInstance.btRigidBody(rbInfo);

    // PHYSICS TUNING
    body.setFriction(0.6);        // Prevent sliding too much
    body.setRollingFriction(0.1); // Help them stop rolling
    body.setRestitution(0.3);     // Bounciness (0 = no bounce, 1 = super ball)

    // Damping simulates air resistance/heavy feel
    // Linear 0.05, Angular 0.1 helps them stop spinning eventually
    body.setDamping(0.05, 0.1);

    // Prevent sleeping too early (so they don't freeze in mid-air/roll)
    body.setActivationState(4); // 4 = DISABLE_DEACTIVATION initialy, we can let them sleep later if needed

    world.addRigidBody(body);

    return body;
};

export const createConvexHullShape = (mesh) => {
    const shape = new AmmoInstance.btConvexHullShape();
    const geometry = mesh.geometry;
    const positionAttribute = geometry.attributes.position;

    for ( let i = 0; i < positionAttribute.count; i ++ ) {
        const v = new THREE.Vector3();
        v.fromBufferAttribute( positionAttribute, i );
        v.applyMatrix4(mesh.matrixWorld);
        const vec = new AmmoInstance.btVector3(v.x, v.y, v.z);
        shape.addPoint(vec);
    }
    return shape;
};
