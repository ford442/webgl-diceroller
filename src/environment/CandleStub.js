import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCandleStub(
    scene,
    physicsWorld,
    position = { x: 3, y: -2.75, z: -3 },
    rotationY = 0
) {
    const radius = 0.15;
    const height = 0.25;

    const waxMaterial = new THREE.MeshStandardMaterial({
        color: 0xddddcc,
        roughness: 0.6,
        metalness: 0.0,
        bumpScale: 0.01,
    });

    const geometry = new THREE.CylinderGeometry(radius * 0.8, radius, height, 16);
    geometry.translate(0, height / 2, 0);

    return createProp(scene, physicsWorld, {
        name: 'CandleStub',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.DEFAULT,
            },
        ],
        build({ group }) {
            const bodyMesh = mesh(geometry, waxMaterial);
            group.add(bodyMesh);
        },
    });
}
