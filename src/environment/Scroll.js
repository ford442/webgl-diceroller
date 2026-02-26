import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createScroll(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'SealedScroll';

    // Dimensions
    const length = 3.0;
    const radius = 0.35;
    const ribbonRadius = radius + 0.02; // Slightly larger
    const ribbonTube = 0.05;

    // --- Materials ---
    // Parchment: Use a simple noise texture if possible, or color
    const parchmentMat = new THREE.MeshStandardMaterial({
        color: 0xf5deb3, // Wheat
        roughness: 0.9,
        bumpScale: 0.02
    });

    // Darker ends for the paper layers
    const paperEndMat = new THREE.MeshStandardMaterial({
        color: 0xcbbfa5, // Darker wheat
        roughness: 1.0
    });

    // Ribbon: Red Velvet
    const ribbonMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000, // Dark Red
        roughness: 0.6,
        metalness: 0.1
    });

    // Wax Seal: Bright Red
    const waxMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000,
        roughness: 0.3,
        metalness: 0.1,
        clearcoat: 0.5,
        clearcoatRoughness: 0.2
    });

    // --- Geometries ---

    // 1. Scroll Body
    // Cylinder is Y-up.
    const bodyGeo = new THREE.CylinderGeometry(radius, radius, length, 32);

    // Create Body Mesh
    const bodyMesh = new THREE.Mesh(bodyGeo, parchmentMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;

    // Add "End Caps" manually to simulate spiral/layers
    // We generated a spiral texture below
    const spiralTexture = generateSpiralTexture();
    const spiralMat = new THREE.MeshStandardMaterial({ map: spiralTexture, color: 0xcbbfa5, roughness: 1.0 });

    const capGeo = new THREE.CircleGeometry(radius * 0.9, 32);

    const capTop = new THREE.Mesh(capGeo, spiralMat);
    capTop.rotation.x = -Math.PI / 2;
    capTop.position.y = length / 2 + 0.001;
    bodyMesh.add(capTop);

    const capBot = new THREE.Mesh(capGeo, spiralMat);
    capBot.rotation.x = Math.PI / 2;
    capBot.position.y = -length / 2 - 0.001;
    bodyMesh.add(capBot);

    group.add(bodyMesh);

    // 2. Ribbon (Torus)
    // Torus is in XY plane. Tube wraps around Z-axis?
    // No, standard Torus lies in XY plane. Z is the axis of the hole.
    // Our Cylinder is Y-aligned.
    // We want Torus to wrap around Y-axis.
    // Rotate Torus X=90.
    const ribbonGeo = new THREE.TorusGeometry(ribbonRadius, ribbonTube, 16, 32);
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.rotation.x = Math.PI / 2;
    ribbonMesh.castShadow = true;
    ribbonMesh.receiveShadow = true;
    group.add(ribbonMesh);

    // 3. Wax Seal
    // Flattened cylinder
    const sealGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16);
    const sealMesh = new THREE.Mesh(sealGeo, waxMat);

    // Position on top of ribbon.
    // Cylinder Y-up. Ribbon wraps Y.
    // Place Seal at +Z radius.
    // Rotate Seal X=90 so its top faces +Z.
    sealMesh.rotation.x = Math.PI / 2;
    sealMesh.position.set(0, 0, radius + 0.05);

    // Inner embossed circle
    const sealInnerGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 16);
    const sealInner = new THREE.Mesh(sealInnerGeo, waxMat);
    sealInner.position.y = 0;
    sealMesh.add(sealInner);

    group.add(sealMesh);


    // --- Position & Rotation ---
    // Scroll Group contains Y-aligned objects.
    // We want it lying flat on the table (XZ plane).
    // So we rotate X=90 deg.
    // Then we want random orientation (Y-rotation in world space).
    // Using Euler order 'YXZ' allows us to rotate Y (direction) first, then X (tilt).

    const angle = Math.random() * Math.PI * 2;
    group.rotation.set(Math.PI / 2, angle, 0, 'YXZ');

    // Wait, if order is YXZ:
    // 1. Y (World Up): Spin around vertical.
    // 2. X (Local Right): Tilt 90 deg.
    // 3. Z (Local Forward): 0.
    // This results in a flat cylinder pointing in 'angle' direction.
    // Correct.

    // Position on table
    // Table Y = -2.75.
    // Radius ~0.35.
    // Center Y = -2.75 + 0.35 = -2.4.
    group.position.set(2, -2.4, 6);

    scene.add(group);

    // --- Physics ---
    // Static Body
    // Shape: Y-aligned Cylinder.
    // createStaticBody uses Group's transform.
    // Group is rotated X=90.
    // So Shape will be rotated X=90 (Lying flat).
    // Correct.

    const ammo = getAmmo();
    // btCylinderShape(halfExtents)
    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, length / 2, radius));
    createStaticBody(physicsWorld, group, shape);
}

function generateSpiralTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#cbbfa5'; // Base color
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = '#a69b82'; // Darker line
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();

    const centerX = 64;
    const centerY = 64;
    // Draw spiral
    for (let i = 0; i < 200; i++) {
        const t = i / 10; // angle
        const r = 1 + i * 0.3; // radius growth
        if (r > 60) break;
        const x = centerX + r * Math.cos(t);
        const y = centerY + r * Math.sin(t);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
