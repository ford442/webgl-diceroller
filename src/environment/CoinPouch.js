import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCoinPouch(
    scene,
    physicsWorld,
    position = { x: -6, y: -2.75, z: 6 },
    rotationY = 0
) {
    const radius = 0.65;
    const height = 1.1;

    const leatherMat = new THREE.MeshStandardMaterial({
        color: 0x5c3a21,
        roughness: 0.9,
        metalness: 0.0,
    });

    const stringMat = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b,
        roughness: 1.0,
        metalness: 0.0,
    });

    const points = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.4, 0.05),
        new THREE.Vector2(0.6, 0.2),
        new THREE.Vector2(0.65, 0.5),
        new THREE.Vector2(0.5, 0.8),
        new THREE.Vector2(0.3, 0.9),
        new THREE.Vector2(0.4, 1.0),
        new THREE.Vector2(0.45, 1.1),
        new THREE.Vector2(0.4, 1.1),
        new THREE.Vector2(0.2, 0.9),
        new THREE.Vector2(0, 0.8),
    ];

    return createProp(scene, physicsWorld, {
        name: 'CoinPouch',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.LEATHER,
            },
        ],
        build({ group }) {
            const yShift = -height / 2;

            group.add(mesh(new THREE.LatheGeometry(points, 32), leatherMat, { position: { y: yShift } }));

            group.add(
                mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 32), stringMat, {
                    position: { y: 0.9 + yShift },
                    rotation: { x: Math.PI / 2 },
                })
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), stringMat, {
                    position: { x: 0.3, y: 0.7 + yShift, z: 0.1 },
                    rotation: { z: -Math.PI / 8, x: Math.PI / 16 },
                })
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), stringMat, {
                    position: { x: 0.3, y: 0.7 + yShift, z: -0.1 },
                    rotation: { z: -Math.PI / 8, x: -Math.PI / 16 },
                })
            );
        },
    });
}
