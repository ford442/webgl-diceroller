import * as THREE from 'three';
import { createProp, STATIC_MATERIAL, mesh } from './propKit.js';

export function createGoblinSkull(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotationY = 0,
    { scale = 1 } = {}
) {
    const skullRadius = 0.4;
    const jawWidth = 0.5;
    const jawHeight = 0.3;
    const jawDepth = 0.5;

    return createProp(scene, physicsWorld, {
        name: 'GoblinSkull',
        position,
        rotation: rotationY,
        footOffsetY: skullRadius,
        scale,
        colliders: [
            {
                type: 'box',
                halfExtents: [skullRadius, skullRadius, skullRadius],
                materialTag: STATIC_MATERIAL.DEFAULT,
            },
        ],
        build({ group }) {
            const boneMaterial = new THREE.MeshStandardMaterial({
                color: 0xddddcc,
                roughness: 0.9,
                metalness: 0.0,
                bumpScale: 0.02,
            });

            // Cranium
            const craniumGeo = new THREE.SphereGeometry(skullRadius, 16, 16);
            const craniumMesh = mesh(craniumGeo, boneMaterial);
            group.add(craniumMesh);

            // Jaw
            const jawGeo = new THREE.BoxGeometry(jawWidth, jawHeight, jawDepth);
            const jawMesh = mesh(jawGeo, boneMaterial, {
                position: { y: -0.2, z: 0.2 },
            });
            group.add(jawMesh);

            // Eye sockets (visual depth)
            const eyeMaterial = new THREE.MeshStandardMaterial({
                color: 0x111111,
                roughness: 1.0,
                metalness: 0.0,
            });
            const eyeGeo = new THREE.SphereGeometry(0.12, 8, 8);

            const leftEye = mesh(eyeGeo, eyeMaterial, {
                position: { x: -0.15, y: 0.1, z: 0.32 },
            });
            group.add(leftEye);

            const rightEye = mesh(eyeGeo, eyeMaterial, {
                position: { x: 0.15, y: 0.1, z: 0.32 },
            });
            group.add(rightEye);
        },
    });
}
