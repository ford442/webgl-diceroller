import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createCharacterSheet(scene, physicsWorld) {
    const width = 4;
    const length = 5.5;
    const thickness = 0.02;

    // Create procedural canvas texture for character sheet
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 704; // ~ 8.5x11 ratio
    const ctx = canvas.getContext('2d');

    // Background (parchment color)
    ctx.fillStyle = '#f0e6d2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw some typical character sheet elements (lines, boxes)
    ctx.strokeStyle = '#4a3c31';
    ctx.lineWidth = 2;

    // Title Box
    ctx.strokeRect(20, 20, 472, 60);
    ctx.fillStyle = '#4a3c31';
    ctx.font = '24px serif';
    ctx.fillText('CHARACTER SHEET', 140, 55);

    // Stats Column
    ctx.strokeRect(20, 100, 100, 580);
    for (let i = 0; i < 6; i++) {
        ctx.strokeRect(30, 120 + i * 90, 80, 70);
        ctx.font = '16px sans-serif';
        const stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
        ctx.fillText(stats[i], 50, 140 + i * 90);
        ctx.font = '24px serif';
        ctx.fillText(Math.floor(Math.random() * 8 + 10).toString(), 55, 175 + i * 90);
    }

    // Skills / Details area
    ctx.strokeRect(140, 100, 352, 280);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        ctx.moveTo(150, 130 + i * 25);
        ctx.lineTo(480, 130 + i * 25);
    }
    ctx.stroke();

    // Equipment / Inventory
    ctx.strokeRect(140, 400, 352, 280);
    ctx.fillText('INVENTORY', 260, 430);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; // Better viewing at shallow angles

    // Material
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9, // Paper is rough
        metalness: 0.0,
        color: 0xffffff
    });

    const geometry = new THREE.BoxGeometry(width, thickness, length);
    const mesh = new THREE.Mesh(geometry, material);

    // Position on table (table surface is Y = -2.75)
    // Add half thickness to sit exactly on top
    mesh.position.set(-4, -2.75 + thickness/2, -3);

    // Slight rotation so it looks casually tossed
    mesh.rotation.y = Math.PI / 6;

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    scene.add(mesh);

    // Physics
    const Ammo = getAmmo();
    if (Ammo) {
        // Simple box shape for the paper
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(width / 2, thickness / 2, length / 2));
        createStaticBody(physicsWorld, mesh, shape);
    }

    return { group: mesh };
}
