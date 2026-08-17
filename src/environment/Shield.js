import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createShield(
    scene,
    physicsWorld,
    position = { x: 16, y: 10, z: 0 },
    rotationY = -Math.PI / 2
) {
    const radius = 2.0;
    const thickness = 0.2;
    const rimThickness = 0.1;

    createProp(scene, physicsWorld, {
        name: 'VikingShield',
        position,
        rotation: rotationY,
        colliders: [{ type: 'box', halfExtents: [radius, radius, thickness / 2 + 0.1] }],
        build({ group }) {
            const woodMaterial = new THREE.MeshStandardMaterial({
                map: createShieldTexture(),
                roughness: 0.8,
                metalness: 0.1,
                color: 0x8b4513,
            });
            const ironMaterial = new THREE.MeshStandardMaterial({
                color: 0x444444,
                roughness: 0.5,
                metalness: 0.8,
            });

            const disk = new THREE.Mesh(
                new THREE.CylinderGeometry(radius, radius, thickness, 32),
                woodMaterial
            );
            disk.rotation.x = Math.PI / 2;
            disk.castShadow = true;
            disk.receiveShadow = true;
            group.add(disk);

            const rim = new THREE.Mesh(
                new THREE.TorusGeometry(radius, rimThickness, 8, 32),
                ironMaterial
            );
            rim.castShadow = true;
            rim.receiveShadow = true;
            group.add(rim);

            const boss = new THREE.Mesh(
                new THREE.SphereGeometry(0.5, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
                ironMaterial
            );
            boss.rotation.x = Math.PI / 2;
            boss.position.z = thickness / 2;
            boss.castShadow = true;
            boss.receiveShadow = true;
            group.add(boss);

            group.rotation.order = 'YXZ';
            group.rotation.x = Math.random() * Math.PI;
        },
    });
}

function createShieldTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#5c4033';
    ctx.fillRect(0, 0, 512, 512);

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3e2b22';
    const plankCount = 8;
    const plankWidth = 512 / plankCount;
    for (let i = 0; i < plankCount; i++) {
        const x = i * plankWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 512);
        ctx.stroke();
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, 0, plankWidth, 512);
    }

    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = '#880000';
    ctx.beginPath();
    ctx.arc(256, 256, 250, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillRect(200, 0, 112, 512);
    ctx.fillRect(0, 200, 512, 112);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(256 + Math.cos(angle) * 200, 256 + Math.sin(angle) * 200, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
