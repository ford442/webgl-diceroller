import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createChalice(
    scene,
    physicsWorld,
    position = { x: 8, y: -2.75, z: -10 },
    rotationY = 0
) {
    const totalHeight = 1.42;
    const maxRadius = 0.45;

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        metalness: 1.0,
        roughness: 0.2,
    });

    const rubyMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000,
        emissive: 0x330000,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.9,
        ior: 1.76,
        thickness: 0.5,
        transparent: true,
    });

    const liquidMat = new THREE.MeshPhysicalMaterial({
        color: 0x4a0404,
        emissive: 0x110000,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.9,
        ior: 1.33,
        thickness: 0.5,
        transparent: true,
    });

    const points = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.3, 0.1),
        new THREE.Vector2(0.4, 0.3),
        new THREE.Vector2(0.45, 0.6),
        new THREE.Vector2(0.43, 0.8),
        new THREE.Vector2(0.44, 0.82),
        new THREE.Vector2(0.4, 0.82),
        new THREE.Vector2(0.38, 0.8),
        new THREE.Vector2(0.4, 0.6),
        new THREE.Vector2(0.35, 0.3),
        new THREE.Vector2(0.25, 0.15),
        new THREE.Vector2(0, 0.05),
    ];

    return createProp(scene, physicsWorld, {
        name: 'Chalice',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: maxRadius,
                halfHeight: totalHeight / 2,
                offset: { y: totalHeight / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            group.add(
                mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.1, 16), goldMat, {
                    position: { y: 0.05 },
                })
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), goldMat, {
                    position: { y: 0.35 },
                })
            );

            group.add(
                mesh(new THREE.SphereGeometry(0.12, 16, 16), goldMat, { position: { y: 0.35 } })
            );

            group.add(
                mesh(new THREE.LatheGeometry(points, 32), goldMat, { position: { y: 0.6 } })
            );

            const gemGeo = new THREE.OctahedronGeometry(0.04, 0);
            const numGems = 4;
            for (let i = 0; i < numGems; i++) {
                const angle = (i / numGems) * Math.PI * 2;
                group.add(
                    mesh(gemGeo, rubyMat, {
                        position: {
                            x: Math.cos(angle) * 0.12,
                            y: 0.35,
                            z: Math.sin(angle) * 0.12,
                        },
                        rotation: {
                            x: Math.random(),
                            y: Math.random(),
                            z: Math.random(),
                        },
                    })
                );
            }

            group.add(
                mesh(new THREE.CylinderGeometry(0.38, 0.25, 0.4, 16), liquidMat, {
                    position: { y: 0.95 },
                })
            );
        },
    });
}
