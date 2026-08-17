import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCharacterSheet(
    scene,
    physicsWorld,
    position = { x: -6, y: -2.75, z: -6 },
    rotationY = Math.PI / 6
) {
    const width = 4;
    const length = 5.5;
    const thickness = 0.02;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 704;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f0e6d2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#4a3c31';
    ctx.lineWidth = 2;

    ctx.strokeRect(20, 20, 472, 60);
    ctx.fillStyle = '#4a3c31';
    ctx.font = '24px serif';
    ctx.fillText('CHARACTER SHEET', 140, 55);

    ctx.strokeRect(20, 100, 100, 580);
    for (let i = 0; i < 6; i++) {
        ctx.strokeRect(30, 120 + i * 90, 80, 70);
        ctx.font = '16px sans-serif';
        const stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
        ctx.fillText(stats[i], 50, 140 + i * 90);
        ctx.font = '24px serif';
        ctx.fillText(Math.floor(Math.random() * 8 + 10).toString(), 55, 175 + i * 90);
    }

    ctx.strokeRect(140, 100, 352, 280);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        ctx.moveTo(150, 130 + i * 25);
        ctx.lineTo(480, 130 + i * 25);
    }
    ctx.stroke();

    ctx.strokeRect(140, 400, 352, 280);
    ctx.fillText('INVENTORY', 260, 430);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0,
        color: 0xffffff,
    });

    return createProp(scene, physicsWorld, {
        name: 'CharacterSheet',
        position,
        rotation: rotationY,
        footOffsetY: thickness / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, thickness / 2, length / 2],
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            group.add(mesh(new THREE.BoxGeometry(width, thickness, length), material));
        },
    });
}
