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

    // 8. Potion Bottle
    createPotionBottle(scene, physicsWorld, ammo);

    // 9. Dungeon Master Screen
    createDMScreen(scene, physicsWorld, ammo);

    // 10. Iron Key
    createKey(scene, physicsWorld, ammo);

    // 11. Quill
    createQuill(scene, physicsWorld, ammo);

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

function createQuill(scene, physicsWorld, ammo) {
    const group = new THREE.Group();
    group.name = 'Quill';

    // --- Inkwell ---
    const potHeight = 0.4;
    const potRadiusTop = 0.25;
    const potRadiusBot = 0.3;

    // Material: Ceramic/Glass
    const potMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.2,
        metalness: 0.5
    });

    const potGeo = new THREE.CylinderGeometry(potRadiusTop, potRadiusBot, potHeight, 16);
    const potMesh = new THREE.Mesh(potGeo, potMat);
    potMesh.castShadow = true;
    potMesh.receiveShadow = true;
    group.add(potMesh);

    // Ink Surface
    const inkGeo = new THREE.CircleGeometry(potRadiusTop - 0.02, 16);
    const inkMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0.0,
        metalness: 0.2
    });
    const inkMesh = new THREE.Mesh(inkGeo, inkMat);
    inkMesh.rotation.x = -Math.PI / 2;
    inkMesh.position.y = potHeight / 2 + 0.001;
    group.add(inkMesh);

    // --- Quill ---
    const quillGroup = new THREE.Group();

    // Shaft
    const shaftLen = 1.2;
    const shaftGeo = new THREE.CylinderGeometry(0.02, 0.01, shaftLen, 8);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0xf5f5dc, roughness: 0.8 }); // Beige
    const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    shaftMesh.castShadow = true;
    // Pivot is at group origin. Move mesh up so bottom is at origin.
    shaftMesh.position.y = shaftLen / 2;
    quillGroup.add(shaftMesh);

    // Feather Vane
    const featherShape = new THREE.Shape();
    featherShape.moveTo(0, 0);
    featherShape.quadraticCurveTo(0.15, 0.3, 0.15, 0.9); // Right side
    featherShape.quadraticCurveTo(0.1, 1.1, 0, 1.2);     // Tip
    featherShape.quadraticCurveTo(-0.1, 1.1, -0.15, 0.9); // Left side
    featherShape.quadraticCurveTo(-0.15, 0.3, 0, 0);      // Base

    const featherGeo = new THREE.ShapeGeometry(featherShape);
    const featherMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        side: THREE.DoubleSide
    });
    const featherMesh = new THREE.Mesh(featherGeo, featherMat);
    featherMesh.castShadow = true;
    featherMesh.receiveShadow = true;
    featherMesh.position.y = 0.2; // Start feathering a bit up the shaft
    quillGroup.add(featherMesh);

    // Orient Quill in Inkwell
    // Tilt slightly randomly
    quillGroup.rotation.z = -Math.PI / 6 - (Math.random() * 0.1);
    quillGroup.rotation.y = Math.random() * Math.PI * 2;

    // Position quill relative to pot center (sticking out)
    quillGroup.position.set(0, potHeight/2 - 0.1, 0); // -0.1 to sit inside ink

    group.add(quillGroup);

    // --- Position on Table ---
    // Table Top -2.75.
    // Pot Height 0.4. Center at -2.75 + 0.2 = -2.55.
    // Position near Parchment (4, -2.74, -3)
    group.position.set(5.5, -2.55, -2.0);

    scene.add(group);

    // --- Physics ---
    // Cylinder shape for the pot
    const shape = new ammo.btCylinderShape(new ammo.btVector3(potRadiusBot, potHeight/2, potRadiusBot));
    createStaticBody(physicsWorld, group, shape);
}

function createKey(scene, physicsWorld, ammo) {
    const keyGroup = new THREE.Group();
    keyGroup.name = 'IronKey';

    // Material: Dark, rough metal
    const material = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.7,
        metalness: 0.9,
    });

    // 1. Bow (Handle)
    // Ring shape
    const bowRadius = 0.3;
    const bowTube = 0.06;
    const bowGeo = new THREE.TorusGeometry(bowRadius, bowTube, 8, 16);
    const bowMesh = new THREE.Mesh(bowGeo, material);
    bowMesh.rotation.x = Math.PI / 2; // Lie flat
    bowMesh.castShadow = true;
    bowMesh.receiveShadow = true;
    keyGroup.add(bowMesh);

    // 2. Shaft
    const shaftLen = 1.0;
    const shaftRadius = 0.06;
    const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 8);
    const shaftMesh = new THREE.Mesh(shaftGeo, material);
    // Cylinder is Y-up. Rotate to Z.
    shaftMesh.rotation.x = Math.PI / 2;
    // Position: End of shaft at edge of bow.
    // Bow center is 0,0,0. Radius 0.3.
    // Shaft starts at 0.3. Center at 0.3 + 0.5 = 0.8.
    shaftMesh.position.z = bowRadius + shaftLen / 2 - 0.05; // -0.05 overlap
    shaftMesh.castShadow = true;
    shaftMesh.receiveShadow = true;
    keyGroup.add(shaftMesh);

    // 3. Collar (Decorative ring on shaft)
    const collarGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8);
    const collarMesh = new THREE.Mesh(collarGeo, material);
    collarMesh.rotation.x = Math.PI / 2;
    collarMesh.position.z = bowRadius + 0.2;
    collarMesh.castShadow = true;
    keyGroup.add(collarMesh);

    // 4. Bit (Teeth)
    // We want it to lie flat. So it should stick out in X.
    // Dimension X should be the "stick out" length.
    const bitGeo = new THREE.BoxGeometry(0.3, 0.1, 0.2);
    const bitMesh = new THREE.Mesh(bitGeo, material);

    // Position near end of shaft.
    bitMesh.position.set(shaftRadius + 0.15, 0, bowRadius + shaftLen - 0.2); // Offset X
    bitMesh.castShadow = true;
    bitMesh.receiveShadow = true;
    keyGroup.add(bitMesh);

    // Complex shape bit? Add another small tooth.
    const bit2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), material);
    bit2.position.set(shaftRadius + 0.1, 0, bowRadius + shaftLen - 0.35);
    bit2.castShadow = true;
    bit2.receiveShadow = true;
    keyGroup.add(bit2);


    // Position on Table
    // Table Top -2.75.
    // Key Thickness (Tube) 0.06. Radius 0.06.
    // Center Y = -2.75 + 0.06 = -2.69.
    keyGroup.position.set(2, -2.69, -5);
    // Random Y rotation
    keyGroup.rotation.y = Math.random() * Math.PI * 2;

    scene.add(keyGroup);

    // Physics
    // Box Shape for simplicity and stability.
    // Size: Width(X) ~ 0.6 (Bow), Height(Y) ~ 0.12, Depth(Z) ~ 1.3.
    const shape = new ammo.btBoxShape(new ammo.btVector3(0.3, 0.06, 0.7));
    createStaticBody(physicsWorld, keyGroup, shape);
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

function createPotionBottle(scene, physicsWorld, ammo) {
    const bottleGroup = new THREE.Group();
    bottleGroup.name = 'PotionBottle';

    // --- Visuals ---

    // 1. Glass Bottle (Lathe)
    // Points for a round-bottom flask
    const points = [];
    for (let i = 0; i <= 10; i++) {
        // Bottom sphere part (radius 0.6)
        const angle = (Math.PI / 2) * (i / 10); // 0 to 90 degrees
        points.push(new THREE.Vector2(Math.sin(angle) * 0.6, -Math.cos(angle) * 0.6));
    }
    // Neck
    points.push(new THREE.Vector2(0.2, 0.2)); // Top of sphere part
    points.push(new THREE.Vector2(0.2, 0.8)); // Top of neck
    // Rim
    points.push(new THREE.Vector2(0.25, 0.8));
    points.push(new THREE.Vector2(0.25, 0.9));
    points.push(new THREE.Vector2(0.15, 0.9)); // Inner rim

    const bottleGeo = new THREE.LatheGeometry(points, 16);

    // Glass Material
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.1,
        transmission: 0.95, // Glass transparency
        thickness: 0.1, // Volume rendering
        ior: 1.5,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide
    });

    const bottleMesh = new THREE.Mesh(bottleGeo, glassMat);
    bottleMesh.castShadow = true;
    bottleMesh.receiveShadow = true;
    bottleGroup.add(bottleMesh);

    // 2. Liquid (Red Health Potion)
    // Slightly smaller version of the bottom part
    const liquidPoints = [];
    for (let i = 0; i <= 8; i++) { // Not full
        const angle = (Math.PI / 2) * (i / 10);
        liquidPoints.push(new THREE.Vector2(Math.sin(angle) * 0.55, -Math.cos(angle) * 0.55));
    }
    // Top surface of liquid
    liquidPoints.push(new THREE.Vector2(0, -Math.cos((Math.PI/2) * 0.8) * 0.55));

    const liquidGeo = new THREE.LatheGeometry(liquidPoints, 16);
    const liquidMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000, // Red
        emissive: 0x220000,
        metalness: 0.1,
        roughness: 0.2,
        transmission: 0.6,
        transparent: true
    });
    const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
    bottleGroup.add(liquidMesh);

    // 3. Cork
    const corkGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.3, 16);
    const corkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
    const corkMesh = new THREE.Mesh(corkGeo, corkMat);
    corkMesh.position.y = 0.85;
    bottleMesh.add(corkMesh);

    // --- Position ---
    // Table top at -2.75.
    // Bottle bottom is at local -0.6 (from lathe points).
    // To sit on table:
    // We want local -0.6 to be at World -2.75.
    // Center Y = -2.75 + 0.6 = -2.15.

    bottleGroup.position.set(6, -2.15, -2);
    // Slight random rotation
    bottleGroup.rotation.y = Math.random() * Math.PI * 2;

    scene.add(bottleGroup);

    // --- Physics ---
    // Approximating with a Cylinder
    const shape = new ammo.btCylinderShape(new ammo.btVector3(0.6, 0.8, 0.6)); // Radius 0.6, Height ~1.6 (full height)
    // Actually height is from -0.6 to 0.9 = 1.5.
    // Cylinder is centered.
    // The bottle center of mass is roughly around 0 in local space (middle of bulb/neck transition).
    // Let's use a simpler shape.

    createStaticBody(physicsWorld, bottleGroup, shape);
}

function createDMScreen(scene, physicsWorld, ammo) {
    // Dimensions
    const centerWidth = 8;
    const wingWidth = 4;
    const height = 3;
    const thickness = 0.2;

    // Materials
    // Wood for back
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033, // Dark Wood
        roughness: 0.8
    });

    // Charts for front (inner side)
    const chartsTexture = generateDMChartsTexture();
    const chartsMat = new THREE.MeshStandardMaterial({
        map: chartsTexture,
        roughness: 0.9,
        color: 0xffffff
    });

    // Geometries
    const centerGeo = new THREE.BoxGeometry(centerWidth, height, thickness);
    const wingGeo = new THREE.BoxGeometry(wingWidth, height, thickness);

    // Materials Array (Charts on Front +Z, Wood elsewhere)
    // BoxGeometry materials indices:
    // 0: Right (+x), 1: Left (-x), 2: Top (+y), 3: Bottom (-y), 4: Front (+z), 5: Back (-z)
    const materials = [woodMat, woodMat, woodMat, woodMat, chartsMat, woodMat];

    // Position parameters
    // Table Top Y = -2.75 (approx). Screen sits on top.
    // Screen Height 3. Center Y = -2.75 + 1.5 = -1.25.
    const screenY = -1.25;
    const screenZ = -8;

    // 1. Center Panel
    const centerMesh = new THREE.Mesh(centerGeo, materials);
    centerMesh.position.set(0, screenY, screenZ);
    centerMesh.castShadow = true;
    centerMesh.receiveShadow = true;
    scene.add(centerMesh);

    const centerShape = new ammo.btBoxShape(new ammo.btVector3(centerWidth/2, height/2, thickness/2));
    createStaticBody(physicsWorld, centerMesh, centerShape);

    // Wings Angle
    const angleRad = Math.PI / 6; // 30 degrees

    // 2. Left Wing
    const leftWingMesh = new THREE.Mesh(wingGeo, materials);
    leftWingMesh.rotation.y = angleRad; // +30 deg

    // Position Calculation
    // Hinge at (-4, -8). Tip at Left.
    // Center X = HingeX - (width/2)*cos(angle)
    // Center Z = HingeZ - (width/2)*sin(angle)
    // Note: angle is -30. cos(-30)=0.866. sin(-30)=-0.5.
    // X = -4 - 2*(0.866) = -5.732
    // Z = -8 - 2*(-0.5) = -7
    const lx = -centerWidth/2 - (wingWidth/2) * Math.cos(angleRad); // cos(30) = cos(-30)
    const lz = screenZ + (wingWidth/2) * Math.sin(angleRad); // - (-0.5) = +0.5? No.
    // Formula: Z = -8 - 2*sin(-30) = -8 - (-1) = -7.
    // So Z = screenZ - (wingWidth/2) * Math.sin(-angleRad).
    // Or Z = screenZ + (wingWidth/2) * Math.sin(angleRad) IF angle was positive?
    // Let's stick to the numbers. We want Z = -7.
    // screenZ = -8. Need +1.
    // sin(30) = 0.5. 2 * 0.5 = 1.

    leftWingMesh.position.set(lx, screenY, screenZ + (wingWidth/2) * Math.sin(angleRad)); // -8 + 1 = -7
    scene.add(leftWingMesh);

    const leftShape = new ammo.btBoxShape(new ammo.btVector3(wingWidth/2, height/2, thickness/2));
    createStaticBody(physicsWorld, leftWingMesh, leftShape);

    // 3. Right Wing
    const rightWingMesh = new THREE.Mesh(wingGeo, materials);
    rightWingMesh.rotation.y = -angleRad; // -30 deg

    // Position
    // Hinge at (4, -8). Tip at Right.
    // Center X = HingeX + (width/2)*cos(angle)
    // Center Z = HingeZ + (width/2)*sin(angle) ? No.
    // We want Z = -7 (Forward). Hinge at -8.
    // Center Z > Hinge Z.
    // X = 4 + 2*cos(30) = 5.732.
    // Z = -8 + 1 = -7.

    // My previous math check said:
    // Right Rot +30.
    // Hinge is Left Edge (local -2).
    // Center = Hinge + 2*(cos 30, sin 30).
    // CenterZ = -8 + 2*0.5 = -7.
    // Correct.

    const rx = centerWidth/2 + (wingWidth/2) * Math.cos(angleRad);
    const rz = screenZ + (wingWidth/2) * Math.sin(angleRad);

    rightWingMesh.position.set(rx, screenY, rz);
    scene.add(rightWingMesh);

    const rightShape = new ammo.btBoxShape(new ammo.btVector3(wingWidth/2, height/2, thickness/2));
    createStaticBody(physicsWorld, rightWingMesh, rightShape);
}

function generateDMChartsTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#fdf5e6';
    ctx.fillRect(0, 0, 1024, 512);

    // Grid/Tables
    ctx.fillStyle = '#000';
    ctx.font = 'bold 30px serif';
    ctx.fillText('RANDOM ENCOUNTERS', 50, 50);

    // Draw some lines
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.moveTo(50, 60);
    ctx.lineTo(400, 60);
    ctx.stroke();

    ctx.font = '24px monospace';
    for(let i=0; i<10; i++) {
        ctx.fillText(`1d20 + ${i}: Goblin Skirmisher`, 50, 90 + i*30);
    }

    ctx.font = 'bold 30px serif';
    ctx.fillText('WEAPON STATS', 500, 50);
    ctx.beginPath();
    ctx.moveTo(500, 60);
    ctx.lineTo(900, 60);
    ctx.stroke();

    ctx.font = '24px monospace';
    const weapons = ['Dagger      1d4', 'Shortsword  1d6', 'Longsword   1d8', 'Greataxe    1d12'];
    weapons.forEach((w, i) => {
        ctx.fillText(w, 500, 90 + i*30);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
