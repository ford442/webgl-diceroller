import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

/**
 * Creates a Wooden Dice Tray with a velvet interior and physics colliders
 * so dice can be rolled into it without escaping.
 */
export function createDiceTray(scene, physicsWorld, position = { x: -4, y: -2.75, z: -2 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'DiceTray';

    // Dimensions
    const width = 8;
    const depth = 6;
    const height = 1.0;
    const thickness = 0.4;
    const floorThickness = 0.2;

    const Ammo = getAmmo();

    const { diffuse: woodDiffuse, roughness: woodRoughness, bump: woodBump } = getWoodTextures();

    // Wood Material
    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        roughnessMap: woodRoughness,
        bumpMap: woodBump,
        bumpScale: 0.05,
        color: 0x8b5a2b, // Darker rich wood color
        roughness: 0.8
    });

    // Velvet Texture (Interior surface)
    // We'll generate a procedural velvet texture for a luxurious feel
    const velvetTexture = generateVelvetTexture();
    const velvetMaterial = new THREE.MeshStandardMaterial({
        map: velvetTexture,
        color: 0x8B0000, // Deep crimson red
        roughness: 0.9,
        metalness: 0.1 // Slight sheen for velvet
    });

    // --- Geometries ---

    // 1. Floor (Velvet top, Wood bottom)
    const floorGeo = new THREE.BoxGeometry(width, floorThickness, depth);
    // BoxGeometry materials: [Right, Left, Top, Bottom, Front, Back]
    const floorMaterials = [
        woodMaterial, woodMaterial,
        velvetMaterial, // Top is velvet
        woodMaterial,
        woodMaterial, woodMaterial
    ];

    const floorMesh = new THREE.Mesh(floorGeo, floorMaterials);
    floorMesh.position.set(0, floorThickness / 2, 0); // Bottom sits at y=0
    floorMesh.castShadow = true;
    floorMesh.receiveShadow = true;
    group.add(floorMesh);

    // 2. Walls (Wood)
    const wallHeight = height;

    // Left/Right Walls (along depth)
    const sideGeo = new THREE.BoxGeometry(thickness, wallHeight, depth);

    const leftWall = new THREE.Mesh(sideGeo, woodMaterial);
    leftWall.position.set(-width / 2 + thickness / 2, wallHeight / 2, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    group.add(leftWall);

    const rightWall = new THREE.Mesh(sideGeo, woodMaterial);
    rightWall.position.set(width / 2 - thickness / 2, wallHeight / 2, 0);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    group.add(rightWall);

    // Front/Back Walls (along width, inner length = width - 2*thickness)
    const frontBackWidth = width - 2 * thickness;
    const frontBackGeo = new THREE.BoxGeometry(frontBackWidth, wallHeight, thickness);

    const backWall = new THREE.Mesh(frontBackGeo, woodMaterial);
    backWall.position.set(0, wallHeight / 2, -depth / 2 + thickness / 2);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    group.add(backWall);

    const frontWall = new THREE.Mesh(frontBackGeo, woodMaterial);
    frontWall.position.set(0, wallHeight / 2, depth / 2 - thickness / 2);
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    group.add(frontWall);

    // --- Position and Rotation ---
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics ---
    // We need a compound shape to represent the hollow tray,
    // or we can add individual static bodies for each part.
    // Adding individual bodies is simpler and perfectly valid for static objects.

    if (Ammo && physicsWorld) {
        // We make the collision walls slightly thicker/taller to prevent fast dice clipping
        const physThick = thickness * 1.5;
        const physHeight = wallHeight * 1.5;

        // 1. Floor Physics
        const pFloorGeo = new THREE.BoxGeometry(width, floorThickness, depth);
        // To use createStaticBody which expects world transform, we need to apply group transform
        const floorDummy = new THREE.Mesh(pFloorGeo);
        group.add(floorDummy);
        floorDummy.position.copy(floorMesh.position);
        floorDummy.updateMatrixWorld(true);

        // Extract world transform
        const wPos = new THREE.Vector3();
        const wQuat = new THREE.Quaternion();
        floorDummy.getWorldPosition(wPos);
        floorDummy.getWorldQuaternion(wQuat);

        const floorProxy = new THREE.Mesh(pFloorGeo);
        floorProxy.position.copy(wPos);
        floorProxy.quaternion.copy(wQuat);

        const floorShape = new Ammo.btBoxShape(new Ammo.btVector3(width / 2, floorThickness / 2, depth / 2));
        createStaticBody(physicsWorld, floorProxy, floorShape);

        // Helper function for walls
        const createWallPhysics = (mesh, w, h, d) => {
            const dummy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
            group.add(dummy);
            dummy.position.copy(mesh.position);
            dummy.updateMatrixWorld(true);

            const wp = new THREE.Vector3();
            const wq = new THREE.Quaternion();
            dummy.getWorldPosition(wp);
            dummy.getWorldQuaternion(wq);

            const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
            proxy.position.copy(wp);
            proxy.quaternion.copy(wq);

            const shape = new Ammo.btBoxShape(new Ammo.btVector3(w / 2, h / 2, d / 2));
            createStaticBody(physicsWorld, proxy, shape);
            group.remove(dummy);
        };

        // Left Wall
        createWallPhysics(leftWall, physThick, physHeight, depth);
        // Right Wall
        createWallPhysics(rightWall, physThick, physHeight, depth);
        // Back Wall
        createWallPhysics(backWall, frontBackWidth, physHeight, physThick);
        // Front Wall
        createWallPhysics(frontWall, frontBackWidth, physHeight, physThick);

        group.remove(floorDummy);
    }

    return { group };
}

/**
 * Generates a procedural noise texture to simulate the look of velvet
 */
function generateVelvetTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base color
    ctx.fillStyle = '#8B0000';
    ctx.fillRect(0, 0, size, size);

    // Add noise for crushed velvet effect
    for (let i = 0; i < 8000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 2 + 1;

        // Randomly make spots slightly lighter or darker
        ctx.fillStyle = Math.random() > 0.5 ? '#A52A2A' : '#600000';
        ctx.globalAlpha = Math.random() * 0.3 + 0.1;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Add some soft brushed lines
    ctx.globalAlpha = 0.05;
    ctx.lineWidth = 4;
    for (let i = 0; i < 50; i++) {
        const y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        // Wavy line
        ctx.quadraticCurveTo(size / 2, y + (Math.random() - 0.5) * 50, size, y + (Math.random() - 0.5) * 20);
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
