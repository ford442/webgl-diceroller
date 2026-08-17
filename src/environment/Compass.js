import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCompass(
    scene,
    physicsWorld,
    position = { x: 8, y: -2.65, z: -8 },
    rotationY = 0
) {
    const radius = 0.6;
    const height = 0.2;

    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        metalness: 1.0,
        roughness: 0.2,
    });

    const faceMat = new THREE.MeshStandardMaterial({
        color: 0xfffdd0,
        roughness: 0.8,
        metalness: 0.0,
        map: generateCompassFaceTexture(),
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.0,
        transmission: 0.9,
        transparent: true,
        ior: 1.5,
        thickness: 0.05,
    });

    const needleMatRed = new THREE.MeshStandardMaterial({
        color: 0xcc0000,
        metalness: 0.5,
        roughness: 0.4,
    });

    const needleMatSilver = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.8,
        roughness: 0.4,
    });

    const result = createProp(scene, physicsWorld, {
        name: 'Compass',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            group.add(mesh(new THREE.CylinderGeometry(radius, radius, height, 32), brassMat));

            const innerRadius = radius - 0.05;
            group.add(
                mesh(new THREE.CylinderGeometry(innerRadius, innerRadius, 0.02, 32), faceMat, {
                    position: { y: 0.05 },
                    receiveShadow: true,
                })
            );

            const needleGroup = new THREE.Group();
            needleGroup.position.y = 0.07;

            const nNeedleMesh = mesh(new THREE.ConeGeometry(0.04, 0.4, 4), needleMatRed, {
                rotation: { x: -Math.PI / 2 },
                position: { z: -0.2 },
            });
            needleGroup.add(nNeedleMesh);

            const sNeedleMesh = mesh(new THREE.ConeGeometry(0.04, 0.4, 4), needleMatSilver, {
                rotation: { x: Math.PI / 2 },
                position: { z: 0.2 },
            });
            needleGroup.add(sNeedleMesh);

            needleGroup.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), brassMat));

            needleGroup.rotation.y = Math.random() * Math.PI * 2;
            group.add(needleGroup);

            group.add(
                mesh(new THREE.CylinderGeometry(innerRadius, innerRadius, 0.02, 32), glassMat, {
                    position: { y: height / 2 - 0.01 },
                })
            );

            group.add(
                mesh(new THREE.BoxGeometry(0.1, 0.1, 0.15), brassMat, {
                    position: { x: 0, y: 0, z: radius + 0.02 },
                })
            );

            group.add(
                mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 16), brassMat, {
                    position: { x: 0, y: 0, z: radius + 0.12 },
                    rotation: { y: Math.PI / 2 },
                })
            );
        },
    });

    return result.group;
}

function generateCompassFaceTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const center = 128;

    ctx.fillStyle = '#fffdd0';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center, center, 120, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const directions = [
        { label: 'N', angle: 0 },
        { label: 'E', angle: Math.PI / 2 },
        { label: 'S', angle: Math.PI },
        { label: 'W', angle: Math.PI * 1.5 },
    ];

    directions.forEach((dir) => {
        const x = center + Math.sin(dir.angle) * 90;
        const y = center - Math.cos(dir.angle) * 90;
        ctx.fillText(dir.label, x, y);
    });

    for (let i = 0; i < 360; i += 15) {
        const rad = (i * Math.PI) / 180;
        const innerRad = i % 90 === 0 ? 105 : 112;
        const x1 = center + Math.sin(rad) * innerRad;
        const y1 = center - Math.cos(rad) * innerRad;
        const x2 = center + Math.sin(rad) * 120;
        const y2 = center - Math.cos(rad) * 120;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = i % 90 === 0 ? 3 : 1;
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
