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

    // 6. Pencil
    createPencil(scene, physicsWorld, ammo);

    // 7. D20 Holder
    createD20Holder(scene, physicsWorld, ammo);

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

    // Generate Character Sheet Texture
    const texture = generateCharacterSheetTexture();

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff, // White base to let texture colors show
        roughness: 0.9,
        bumpScale: 0.01
    });

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

function generateCharacterSheetTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 700; // Aspect ratio ~ 5x7 like the mesh
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#f5deb3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header
    ctx.fillStyle = '#2c1b0e';
    ctx.font = 'bold 40px serif';
    ctx.fillText('CHARACTER SHEET', 80, 50);

    // Name Field
    ctx.font = '24px serif';
    ctx.fillText('Name: __________________', 40, 100);
    ctx.fillText('Class: __________________', 40, 140);

    // Stats Box
    const startY = 200;
    const boxHeight = 60;
    const stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

    ctx.font = 'bold 24px serif';
    stats.forEach((stat, i) => {
        const y = startY + i * boxHeight;
        // Label
        ctx.fillStyle = '#2c1b0e';
        ctx.fillText(stat, 40, y + 30);

        // Box
        ctx.strokeRect(100, y, 60, 40);

        // Random Score
        ctx.font = '20px monospace';
        const score = Math.floor(Math.random() * 8) + 10; // 10-18
        ctx.fillText(score.toString(), 115, y + 27);
        ctx.font = 'bold 24px serif';
    });

    // Scribbles
    ctx.font = 'italic 16px serif';
    ctx.fillStyle = '#553311';
    ctx.fillText('Inventory:', 250, 200);
    ctx.fillText('- Longsword', 260, 230);
    ctx.fillText('- Rope (50ft)', 260, 260);
    ctx.fillText('- Rations', 260, 290);

    // Coffee Stain
    ctx.strokeStyle = 'rgba(80, 40, 0, 0.1)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(350, 500, 40, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function createD20Holder(scene, physicsWorld, ammo) {
    const holderGroup = new THREE.Group();

    // Material: Dark polished wood
    const material = new THREE.MeshStandardMaterial({
        color: 0x3f1f1f,
        roughness: 0.3,
        metalness: 0.1
    });

    // Base: Hexagonal prism
    const radius = 0.8;
    const height = 0.4;
    const baseGeo = new THREE.CylinderGeometry(radius, radius, height, 6);
    const baseMesh = new THREE.Mesh(baseGeo, material);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    holderGroup.add(baseMesh);

    // Indentation (Visual trick: black circle on top)
    const indGeo = new THREE.CircleGeometry(0.5, 32);
    const indMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const indMesh = new THREE.Mesh(indGeo, indMat);
    indMesh.rotation.x = -Math.PI / 2;
    indMesh.position.y = height / 2 + 0.001;
    holderGroup.add(indMesh);

    // Position on table
    // Table -2.75. Height 0.4. Center -2.75 + 0.2 = -2.55.
    holderGroup.position.set(-2, -2.55, -4);

    scene.add(holderGroup);

    // Physics
    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height/2, radius));
    createStaticBody(physicsWorld, holderGroup, shape);
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

function createPencil(scene, physicsWorld, ammo) {
    const pencilGroup = new THREE.Group();

    // Dimensions
    const radius = 0.04;
    const bodyLen = 1.2;
    const ferruleLen = 0.15;
    const eraserLen = 0.15;
    const tipLen = 0.25;

    // Materials
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffbd2e, roughness: 0.6 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 0.8 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.2 });
    const pinkMat = new THREE.MeshStandardMaterial({ color: 0xff69b4, roughness: 0.9 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

    // 1. Body (Hexagonal Cylinder)
    const bodyGeo = new THREE.CylinderGeometry(radius, radius, bodyLen, 6);
    const bodyMesh = new THREE.Mesh(bodyGeo, yellowMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    pencilGroup.add(bodyMesh);

    // 2. Ferrule (Metal band at top)
    const ferruleGeo = new THREE.CylinderGeometry(radius, radius, ferruleLen, 32);
    const ferruleMesh = new THREE.Mesh(ferruleGeo, metalMat);
    ferruleMesh.castShadow = true;
    ferruleMesh.receiveShadow = true;
    ferruleMesh.position.y = bodyLen / 2 + ferruleLen / 2;
    pencilGroup.add(ferruleMesh);

    // 3. Eraser (Pink cylinder at top)
    const eraserGeo = new THREE.CylinderGeometry(radius, radius, eraserLen, 32);
    const eraserMesh = new THREE.Mesh(eraserGeo, pinkMat);
    eraserMesh.castShadow = true;
    eraserMesh.receiveShadow = true;
    eraserMesh.position.y = bodyLen / 2 + ferruleLen + eraserLen / 2;
    pencilGroup.add(eraserMesh);

    // 4. Wood Tip (Cone at bottom)
    const tipGeo = new THREE.CylinderGeometry(radius, 0.015, tipLen, 6);
    const tipMesh = new THREE.Mesh(tipGeo, woodMat);
    tipMesh.castShadow = true;
    tipMesh.receiveShadow = true;
    tipMesh.position.y = -(bodyLen / 2 + tipLen / 2);
    pencilGroup.add(tipMesh);

    // 5. Lead (Small cone at very bottom)
    const leadLen = 0.05;
    const leadGeo = new THREE.CylinderGeometry(0.015, 0, leadLen, 6);
    const leadMesh = new THREE.Mesh(leadGeo, blackMat);
    leadMesh.castShadow = true;
    leadMesh.receiveShadow = true;
    leadMesh.position.y = -(bodyLen / 2 + tipLen + leadLen / 2);
    pencilGroup.add(leadMesh);

    // Transform the whole group to lie on table
    // Table top -2.75.
    // Radius 0.04.
    // Y position = -2.75 + 0.04 = -2.71.
    pencilGroup.position.set(0, -2.71, 4.5);

    // Rotate 90 deg around Z to lie flat, but randomize Y direction first.
    // We use 'YXZ' order:
    // 1. Y: Spin around vertical axis (direction).
    // 2. X: 0.
    // 3. Z: 90 degrees (Lay flat).
    pencilGroup.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2, 'YXZ');

    scene.add(pencilGroup);

    // Physics
    // Approximating with a Box is easiest for rolling stability, but Cylinder rolls.
    // Total length = body + ferrule + eraser + tip + lead.
    const totalLen = bodyLen + ferruleLen + eraserLen + tipLen + leadLen;
    // Physics shape aligned with Y axis.
    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, totalLen / 2, radius));

    createStaticBody(physicsWorld, pencilGroup, shape);
}
