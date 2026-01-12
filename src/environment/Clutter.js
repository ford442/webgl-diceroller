import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createClutter(scene, physicsWorld) {
    const ammo = getAmmo();

    // 1. Mug
    createMug(scene, physicsWorld, ammo);

    // 2. Coin
    createCoin(scene, physicsWorld, ammo);

    // 3. Book
    createBook(scene, physicsWorld, ammo);

    // 4. Parchment
    createParchment(scene, physicsWorld, ammo);

    // 5. Candle
    const flamePosition = createCandle(scene, physicsWorld, ammo);

    return {
        flamePosition
    };
}

function createMug(scene, physicsWorld, ammo) {
    // Visuals
    const mugGroup = new THREE.Group();

    // Cup body
    const bodyGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    // Dark ceramic material
    const material = new THREE.MeshStandardMaterial({
        color: 0x4a3c31,
        roughness: 0.2,
        metalness: 0.1
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    mugGroup.add(bodyMesh);

    // Handle (Torus)
    const handleGeo = new THREE.TorusGeometry(0.3, 0.08, 16, 32);
    const handleMesh = new THREE.Mesh(handleGeo, material);
    handleMesh.position.set(0.5, 0, 0);
    // Rotate to stand upright on the side
    handleMesh.rotation.set(0, Math.PI / 2, 0);

    handleMesh.castShadow = true;
    mugGroup.add(handleMesh);

    // Position Mug on table
    // Table top is -2.75. Mug height 1. Center at -2.75 + 0.5 = -2.25.
    mugGroup.position.set(5, -2.25, 5);
    // Rotate randomly
    mugGroup.rotation.y = Math.random() * Math.PI * 2;

    scene.add(mugGroup);

    // Physics
    const shape = new ammo.btCylinderShape(new ammo.btVector3(0.5, 0.5, 0.5));
    createStaticBody(physicsWorld, mugGroup, shape);
}

function createCoin(scene, physicsWorld, ammo) {
    // Visuals
    const radius = 0.3;
    const thickness = 0.05;
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 32);
    const material = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 1.0,
        roughness: 0.3
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position
    // Table top -2.75.
    // Coin thickness 0.05. Center at -2.75 + 0.025 = -2.725.
    mesh.position.set(-4, -2.725, 3);
    mesh.rotation.y = Math.random() * Math.PI * 2;

    scene.add(mesh);

    // Physics
    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, thickness / 2, radius));
    createStaticBody(physicsWorld, mesh, shape);
}

function createBook(scene, physicsWorld, ammo) {
    // Visuals
    const width = 3;
    const height = 0.5;
    const depth = 4;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshStandardMaterial({
        color: 0x8b0000, // Dark red
        roughness: 0.6
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position
    // Table top -2.75. Center at -2.75 + 0.25 = -2.5.
    mesh.position.set(-6, -2.5, -6);
    mesh.rotation.y = 0.2; // Slight angle

    scene.add(mesh);

    // Physics
    const shape = new ammo.btBoxShape(new ammo.btVector3(width / 2, height / 2, depth / 2));
    createStaticBody(physicsWorld, mesh, shape);
}

function createParchment(scene, physicsWorld, ammo) {
    // Visuals: A sheet of paper/parchment
    const width = 5;
    const depth = 7;
    const thickness = 0.02; // Very thin
    const geometry = new THREE.BoxGeometry(width, thickness, depth);
    const material = new THREE.MeshStandardMaterial({
        color: 0xf5deb3, // Wheat
        roughness: 0.9,
        bumpScale: 0.01
    });

    // Create a texture (optional, or just noise if we had it)
    // For now simple color.

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;

    // Position
    // Table top -2.75. Center at -2.75 + 0.01 = -2.74.
    mesh.position.set(4, -2.74, -3);
    mesh.rotation.y = -0.3;

    scene.add(mesh);

    // Physics
    // Even though it's thin, it needs physics or dice will clip/float oddly if they land on it.
    const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, thickness/2, depth/2));
    createStaticBody(physicsWorld, mesh, shape);
}

function createCandle(scene, physicsWorld, ammo) {
    const candleGroup = new THREE.Group();

    // Candle Body
    const radius = 0.4;
    const height = 1.5;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
    const material = new THREE.MeshStandardMaterial({
        color: 0xeeeecc, // Off-white wax
        roughness: 0.4,
        metalness: 0.0
        // SSS is hard in standard Three.js without transmission or custom shader,
        // but simple standard material is fine.
    });
    const candleMesh = new THREE.Mesh(geometry, material);
    candleMesh.castShadow = true;
    candleMesh.receiveShadow = true;
    candleGroup.add(candleMesh);

    // Wick
    const wickHeight = 0.2;
    const wickGeo = new THREE.CylinderGeometry(0.05, 0.05, wickHeight, 8);
    const wickMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1.0 });
    const wickMesh = new THREE.Mesh(wickGeo, wickMat);
    wickMesh.position.set(0, height/2 + wickHeight/2, 0);
    candleMesh.add(wickMesh); // Attach to candle mesh so it moves with it

    // Flame (Visual Only)
    // We can use a Sprite or a small emissive mesh
    const flameGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.position.set(0, height/2 + wickHeight + 0.05, 0);
    candleMesh.add(flameMesh);

    // Position
    // Table top -2.75. Height 1.5. Center at -2.75 + 0.75 = -2.0.
    const posX = -2;
    const posZ = -6;
    const posY = -2.0;

    candleGroup.position.set(posX, posY, posZ);
    scene.add(candleGroup);

    // Physics
    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height/2, radius));
    createStaticBody(physicsWorld, candleGroup, shape);

    // Calculate flame world position
    // Group pos + candle internal offset
    // Candle mesh is at 0,0,0 inside group.
    // Flame is at (0, height/2 + wickHeight + 0.05, 0) inside candle mesh.
    // So world Y = posY + height/2 + wickHeight + 0.05
    // = -2.0 + 0.75 + 0.2 + 0.05 = -1.0
    const flameWorldPos = new THREE.Vector3(posX, posY + height/2 + wickHeight + 0.05, posZ);

    return flameWorldPos;
}
