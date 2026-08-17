import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createBreadLoaf(
    scene,
    physicsWorld,
    position = { x: 8, y: -2.75, z: 4 },
    rotationY = Math.PI / 6
) {
    const width = 1.2;
    const height = 0.8;
    const depth = 2.0;

    const crustMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b,
        roughness: 0.9,
        metalness: 0.0,
        bumpScale: 0.05,
    });

    return createProp(scene, physicsWorld, {
        name: 'BreadLoaf',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, height / 2, depth / 2],
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const geometry = new THREE.SphereGeometry(1, 32, 16);
            const loafMesh = mesh(geometry, crustMaterial);
            loafMesh.scale.set(width / 2, height / 2, depth / 2);
            loafMesh.position.y = 0;
            group.add(loafMesh);
        },
    });
}
