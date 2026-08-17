import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createScroll(
    scene,
    physicsWorld,
    position = { x: 8, y: -2.4, z: 12 },
    rotationY = 0
) {
    const length = 3.0;
    const radius = 0.35;
    const ribbonRadius = radius + 0.02;
    const ribbonTube = 0.05;
    const angle = Math.random() * Math.PI * 2;

    createProp(scene, physicsWorld, {
        name: 'SealedScroll',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: length / 2,
                rotation: { x: Math.PI / 2 },
            },
        ],
        build({ group }) {
            const parchmentMat = new THREE.MeshStandardMaterial({
                color: 0xf5deb3,
                roughness: 0.9,
                bumpScale: 0.02,
            });
            const ribbonMat = new THREE.MeshStandardMaterial({
                color: 0x8b0000,
                roughness: 0.6,
                metalness: 0.1,
            });
            const waxMat = new THREE.MeshPhysicalMaterial({
                color: 0xff0000,
                roughness: 0.3,
                metalness: 0.1,
                clearcoat: 0.5,
                clearcoatRoughness: 0.2,
            });

            const bodyMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(radius, radius, length, 32),
                parchmentMat
            );
            bodyMesh.castShadow = true;
            bodyMesh.receiveShadow = true;

            const spiralMat = new THREE.MeshStandardMaterial({
                map: generateSpiralTexture(),
                color: 0xcbbfa5,
                roughness: 1.0,
            });
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

            const ribbonMesh = new THREE.Mesh(
                new THREE.TorusGeometry(ribbonRadius, ribbonTube, 16, 32),
                ribbonMat
            );
            ribbonMesh.rotation.x = Math.PI / 2;
            ribbonMesh.castShadow = true;
            ribbonMesh.receiveShadow = true;
            group.add(ribbonMesh);

            const sealMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16), waxMat);
            sealMesh.rotation.x = Math.PI / 2;
            sealMesh.position.set(0, 0, radius + 0.05);
            sealMesh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 16), waxMat));
            group.add(sealMesh);

            group.rotation.set(Math.PI / 2, angle, 0, 'YXZ');
        },
    });
}

function generateSpiralTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#cbbfa5';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#a69b82';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 200; i++) {
        const t = i / 10;
        const r = 1 + i * 0.3;
        if (r > 60) break;
        const x = 64 + r * Math.cos(t);
        const y = 64 + r * Math.sin(t);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
