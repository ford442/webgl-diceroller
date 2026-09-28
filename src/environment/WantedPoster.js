import * as THREE from 'three';
import { createProp } from './propKit.js';

function generateWantedPosterTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f5deb3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#2c1b0e';
    ctx.font = 'bold 80px serif';
    ctx.textAlign = 'center';
    ctx.fillText('WANTED', canvas.width / 2, 100);

    ctx.font = 'bold 40px serif';
    ctx.fillText('DEAD OR ALIVE', canvas.width / 2, 160);

    ctx.strokeRect(100, 200, 312, 300);
    ctx.fillStyle = '#000';
    ctx.fillRect(110, 210, 292, 280);

    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 300, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 550, 120, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(canvas.width / 2 - 30, 300, 10, 0, Math.PI * 2);
    ctx.arc(canvas.width / 2 + 30, 300, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2c1b0e';
    ctx.font = 'bold 60px serif';
    ctx.fillText('REWARD', canvas.width / 2, 580);
    ctx.font = 'bold 80px serif';
    ctx.fillText('10,000 GP', canvas.width / 2, 660);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createWantedPoster(
    scene,
    physicsWorld,
    position = { x: 0, y: -2.74, z: -2 },
    rotationY = 0.1,
    { scale = 1 } = {}
) {
    const width = 2.5;
    const height = 3.5;
    const thickness = 0.02;

    return createProp(scene, physicsWorld, {
        name: 'WantedPoster',
        position,
        rotation: rotationY,
        scale,
        colliders: [{ type: 'box', halfExtents: [width / 2, thickness / 2, height / 2] }],
        build({ group }) {
            const geometry = new THREE.BoxGeometry(width, thickness, height);
            const material = new THREE.MeshStandardMaterial({
                map: generateWantedPosterTexture(),
                roughness: 0.9,
                metalness: 0.0,
                color: 0xffffff,
            });

            const posterMesh = new THREE.Mesh(geometry, material);
            posterMesh.receiveShadow = true;
            posterMesh.castShadow = true;
            group.add(posterMesh);
        },
    });
}
