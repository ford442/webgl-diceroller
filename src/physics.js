import Ammo from 'ammo.js';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
            console.warn("Ammo() failed or is not a promise, retrying synchronously.", e);
            AmmoInstance = Ammo();
        }
    } else {
        AmmoInstance = Ammo;
    }

    // Check for initialization
    if (!AmmoInstance.btVector3) {
        console.error("Ammo.btVector3 is missing. Ammo object:", AmmoInstance);
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

export const createFloorAndWalls = (scene, world, tableConfig = null) => {
    // Floor
    let floorY = -5;
    let width = 25;
    let depth = 25;
    let thickness = 1;

    if (tableConfig) {
        // Use table config for floor physics
        // Ensure we handle the config from Table.js correctly
        floorY = tableConfig.position.y;
        width = tableConfig.width;
        depth = tableConfig.depth;
        thickness = tableConfig.height;

        console.log("Physics: Creating floor from config", { floorY, width, depth, thickness });

        // Visuals are already created by Table.js, so we only need physics for the floor
        // Note: floorY matches the visual mesh position. The box shape is centered at floorY,
        // so the top surface is at floorY + thickness/2.
        // Visual mesh is also centered at floorY, so surfaces align.
        console.log(`Creating physics floor at Y=${floorY} with thickness=${thickness}`);
        createPhysicsBox(world, width, thickness, depth, tableConfig.position.x, floorY, tableConfig.position.z, 0);
    } else {
        // Fallback or legacy floor
        createBox(scene, world, 25, 1, 25, 0, -5, 0, 0, 0xffffff, 'images/wood.jpg');
    }

    // Walls - Adjusted based on floor size
    // We want walls around the floor area.
    let wallHeight = 100; // Default invisible high wall
    let wallThickness = 1;
    let wallOffsetY = 0; // Relative to floorY if we want to shift it up/down

    // Adjust walls based on config if provided (to match visual rims)
    if (tableConfig && tableConfig.walls) {
        // Use visual rim height + some buffer, OR just use the rim height if we want realistic physics (dice can fly out)
        // Let's make it match the visual rim exactly for now, but maybe extend slightly upwards if needed.
        // The user prompt says "The collision box needs to be slightly larger than the visual tray so dice don't clip through walls."
        // So let's make it taller or thicker?
        // Let's stick to the config height but maybe verify thickness.
        wallHeight = tableConfig.walls.height;
        wallThickness = tableConfig.walls.thickness;
        // Visual Rim Center Y relative to floor center (0 local): tableConfig.walls.offsetY
        // floorY is World Y of floor center.
        // So wall center Y = floorY + tableConfig.walls.offsetY
        // BUT wait, floorY is passed as -3. Visual floor is at -3.
        // tableConfig.walls.offsetY is 0.75 (relative to -3).
        // So Wall Y = -3 + 0.75 = -2.25.
        // This matches our calculation in Table.js.

        // HOWEVER: createBox expects wallY to be center of box.
        // If we use wallOffsetY from config, we can calculate wallY directly.
        wallOffsetY = tableConfig.walls.offsetY;
    }

    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    // Calculate wall center Y
    // If using config: floorY + wallOffsetY
    // If not using config: floorY + wallHeight/2
    const wallY = (tableConfig && tableConfig.walls) ? (floorY + wallOffsetY) : (floorY + wallHeight / 2);

    console.log(`Creating physics walls at Y=${wallY} with Height=${wallHeight} Thickness=${wallThickness}`);

    // Create walls matching the rim positions
    // Left/Right Walls
    // Position X: +/- (halfWidth + wallThickness/2)
    // Dimension: wallThickness x wallHeight x depth
    // Note: In Table.js, Top/Bottom rims span full width (width + 2*rimWidth).
    // Here we use overlapping boxes?
    // createBox creates physics box.
    // If we want exact match:
    // Side walls: 1 x 2 x 20. Position +/- 10.5.
    // Top/Bottom walls: 22 x 2 x 1. Position +/- 10.5.

    // Side Walls
    createBox(scene, world, wallThickness, wallHeight, depth, halfWidth + wallThickness/2, wallY, 0, 0, 0x000000, null, true);
    createBox(scene, world, wallThickness, wallHeight, depth, -halfWidth - wallThickness/2, wallY, 0, 0, 0x000000, null, true);

    // Top/Bottom Walls
    // Width for these should cover the corners if we want to match visual "TopBotWidth" from Table.js
    // width + 2*wallThickness
    const topBotWidth = width + 2 * wallThickness;
    createBox(scene, world, topBotWidth, wallHeight, wallThickness, 0, wallY, halfDepth + wallThickness/2, 0, 0x000000, null, true);
    createBox(scene, world, topBotWidth, wallHeight, wallThickness, 0, wallY, -halfDepth - wallThickness/2, 0, 0x000000, null, true);
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

    world.addRigidBody(body);
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
    createPhysicsBox(world, sx, sy, sz, px, py, pz, mass);
};


// Placeholder for spawning dice physics
export const spawnDicePhysics = (world, mesh, collisionShape, position, rotation) => {
    const mass = 15;
    const transform = new AmmoInstance.btTransform();
    transform.setIdentity();
    transform.setOrigin(new AmmoInstance.btVector3(position.x, position.y, position.z));

    // Convert Euler rotation to quaternion using THREE.js
    const threeQuat = new THREE.Quaternion();
    threeQuat.setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z));
    
    const q = new AmmoInstance.btQuaternion(threeQuat.x, threeQuat.y, threeQuat.z, threeQuat.w);
    transform.setRotation(q);

    const motionState = new AmmoInstance.btDefaultMotionState(transform);
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);
    collisionShape.calculateLocalInertia(mass, localInertia);

    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, collisionShape, localInertia);
    const body = new AmmoInstance.btRigidBody(rbInfo);

    world.addRigidBody(body);

    return body;
};

export const createStaticBody = (world, mesh, shape) => {
    const mass = 0; // Static
    const transform = new AmmoInstance.btTransform();
    transform.setIdentity();
    transform.setOrigin(new AmmoInstance.btVector3(mesh.position.x, mesh.position.y, mesh.position.z));

    // Quaternion
    const q = new AmmoInstance.btQuaternion(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w);
    transform.setRotation(q);

    const motionState = new AmmoInstance.btDefaultMotionState(transform);
    const localInertia = new AmmoInstance.btVector3(0, 0, 0);

    const rbInfo = new AmmoInstance.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
    const body = new AmmoInstance.btRigidBody(rbInfo);

    world.addRigidBody(body);
    return body;
};

// Helper to create convex hull shape from mesh
export const createConvexHullShape = (mesh) => {
    const shape = new AmmoInstance.btConvexHullShape();

    // Clone geometry to avoid modifying the visual mesh
    let geometry = mesh.geometry.clone();

    // Merge vertices to remove duplicates and reduce count
    geometry = BufferGeometryUtils.mergeVertices(geometry);

    const positionAttribute = geometry.attributes.position;
    console.log(`Creating convex hull from ${positionAttribute.count} vertices (original: ${mesh.geometry.attributes.position.count})`);

    for ( let i = 0; i < positionAttribute.count; i ++ ) {
        const v = new THREE.Vector3();
        v.fromBufferAttribute( positionAttribute, i );
        // Apply scale if any (matrixWorld of the mesh)
        // Note: matrixWorld might include position/rotation which we might not want if we set transform later?
        // Usually for a shape, we want local coordinates scaled.
        // If mesh.matrixWorld includes position, the shape origin will be offset.
        // Usually we want the shape centered.
        // Let's assume the mesh is centered at 0,0,0 and we just want to apply scale.
        // But the previous code applied matrixWorld. Let's check if we should only apply scale.

        // If the mesh is already at 0,0,0, applying matrixWorld (which might be identity or contain transform)
        // is risky if the mesh was just loaded and not positioned yet.
        // However, in dice.js, we see:
        // cleanMesh.position.set(0, 0, 0);
        // cleanMesh.scale.set(1, 1, 1);
        // So matrixWorld is likely Identity.

        v.applyMatrix4(mesh.matrixWorld);

        const vec = new AmmoInstance.btVector3(v.x, v.y, v.z);
        shape.addPoint(vec);
    }

    return shape;
};
