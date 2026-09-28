import * as THREE from 'three';
import { createProp } from './propKit.js';

function generateCharacterSheetTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f5deb3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#2c1b0e';
    ctx.font = 'bold 40px serif';
    ctx.fillText('CHARACTER SHEET', 80, 50);

    ctx.font = '24px serif';
    ctx.fillText('Name: __________________', 40, 100);
    ctx.fillText('Class: __________________', 40, 140);

    const startY = 200;
    const boxHeight = 60;
    const stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

    ctx.font = 'bold 24px serif';
    stats.forEach((stat, i) => {
        const y = startY + i * boxHeight;
        ctx.fillStyle = '#2c1b0e';
        ctx.fillText(stat, 40, y + 30);
        ctx.strokeRect(100, y, 60, 40);
        ctx.font = '20px monospace';
        const score = Math.floor(Math.random() * 8) + 10;
        ctx.fillText(score.toString(), 115, y + 27);
        ctx.font = 'bold 24px serif';
    });

    ctx.font = 'italic 16px serif';
    ctx.fillStyle = '#553311';
    ctx.fillText('Inventory:', 250, 200);
    ctx.fillText('- Longsword', 260, 230);
    ctx.fillText('- Rope (50ft)', 260, 260);
    ctx.fillText('- Rations', 260, 290);

    ctx.strokeStyle = 'rgba(80, 40, 0, 0.1)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(350, 500, 40, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createParchment(
    scene,
    physicsWorld,
    position = { x: 4, y: -2.74, z: -3 },
    rotationY = -0.3,
    { scale = 1 } = {}
) {
    const width = 5;
    const depth = 7;
    const thickness = 0.02;

    return createProp(scene, physicsWorld, {
        name: 'Parchment',
        position,
        rotation: rotationY,
        scale,
        colliders: [{ type: 'box', halfExtents: [width / 2, thickness / 2, depth / 2] }],
        build({ group }) {
            const geometry = new THREE.BoxGeometry(width, thickness, depth);
            const material = new THREE.MeshStandardMaterial({
                map: generateCharacterSheetTexture(),
                color: 0xffffff,
                roughness: 0.9,
                bumpScale: 0.01,
            });

            const parchmentMesh = new THREE.Mesh(geometry, material);
            parchmentMesh.receiveShadow = true;
            group.add(parchmentMesh);
        },
    });
}
