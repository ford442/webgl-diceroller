import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createMap(
    scene,
    physicsWorld,
    position = { x: -8, y: -2.75, z: 12 },
    rotationY = 0
) {
    const width = 10;
    const depth = 7;
    const thickness = 0.05;

    const weightPositions = [
        { x: -width / 2 + 0.5, z: -depth / 2 + 0.5 },
        { x: width / 2 - 0.5, z: -depth / 2 + 0.5 },
        { x: -width / 2 + 0.5, z: depth / 2 - 0.5 },
        { x: width / 2 - 0.5, z: depth / 2 - 0.5 },
    ];

    const colliders = [
        {
            type: 'box',
            halfExtents: [width / 2, thickness / 2, depth / 2],
            materialTag: STATIC_MATERIAL.DEFAULT,
        },
        ...weightPositions.map((pos) => ({
            type: 'cylinder',
            radius: 0.3,
            halfHeight: 0.2,
            offset: { x: pos.x, y: thickness / 2 + 0.2, z: pos.z },
            materialTag: STATIC_MATERIAL.METAL,
        })),
    ];

    createProp(scene, physicsWorld, {
        name: 'WorldMap',
        position,
        rotation: rotationY,
        footOffsetY: thickness / 2,
        colliders,
        build({ group }) {
            const texture = generateMapTexture();
            const mapMaterial = new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.8,
                metalness: 0.1,
                side: THREE.DoubleSide,
            });

            group.add(mesh(new THREE.BoxGeometry(width, thickness, depth), mapMaterial));

            const weightGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16);
            const weightMat = materials.iron();
            weightMat.color.setHex(0x333333);

            weightPositions.forEach((pos) => {
                group.add(
                    mesh(weightGeo, weightMat, {
                        position: { x: pos.x, y: thickness / 2 + 0.2, z: pos.z },
                    })
                );
            });
        },
    });
}

function generateMapTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#e3d2b4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    const gridSize = 64;
    for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    ctx.fillStyle = '#aaddff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(300, 0);
    for (let y = 0; y <= canvas.height; y += 20) {
        const x = 300 + Math.sin(y * 0.01) * 50 + Math.random() * 20;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(0, canvas.height);
    ctx.fill();

    ctx.fillStyle = '#8b4513';
    for (let i = 0; i < 20; i++) {
        const x = 400 + Math.random() * 400;
        const y = 100 + Math.random() * 200;
        const s = 30 + Math.random() * 30;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + s / 2, y - s);
        ctx.lineTo(x + s, y);
        ctx.fill();
    }

    ctx.fillStyle = '#228b22';
    for (let i = 0; i < 50; i++) {
        const x = 600 + Math.random() * 300;
        const y = 400 + Math.random() * 300;
        const r = 10 + Math.random() * 10;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.strokeStyle = '#0000ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(500, 200);
    let cx = 500;
    let cy = 200;
    while (cx > 300) {
        cx -= 10;
        cy += (Math.random() - 0.3) * 20;
        ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    ctx.fillStyle = '#4b0082';
    ctx.font = 'bold 40px serif';
    ctx.fillText('Kingdom of Aethelgard', 400, 80);
    ctx.font = 'italic 24px serif';
    ctx.fillText('The Whispering Woods', 650, 600);
    ctx.fillText("Dragon's Teeth", 500, 150);

    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 8;
    const tx = 750;
    const ty = 500;
    ctx.beginPath();
    ctx.moveTo(tx - 20, ty - 20);
    ctx.lineTo(tx + 20, ty + 20);
    ctx.moveTo(tx + 20, ty - 20);
    ctx.lineTo(tx - 20, ty + 20);
    ctx.stroke();
    ctx.fillStyle = '#ff0000';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Dig Here', tx - 30, ty + 40);

    const compassX = 900;
    const compassY = 100;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(compassX, compassY - 40);
    ctx.lineTo(compassX, compassY + 40);
    ctx.moveTo(compassX - 30, compassY);
    ctx.lineTo(compassX + 30, compassY);
    ctx.stroke();
    ctx.fillText('N', compassX - 10, compassY - 50);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
