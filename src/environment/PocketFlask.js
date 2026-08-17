import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createPocketFlask(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 5 },
    rotationY = 0
) {
    const width = 1.0;
    const height = 1.5;
    const depth = 0.4;
    const capRadius = 0.15;
    const capHeight = 0.3;

    return createProp(scene, physicsWorld, {
        name: 'PocketFlask',
        position,
        rotation: rotationY,
        footOffsetY: depth / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, height / 2, depth / 2],
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const flaskMat = materials.pewter();
            const capMat = materials.steel();

            const bodyMesh = mesh(new THREE.CylinderGeometry(width / 2, width / 2, height, 32), flaskMat);
            bodyMesh.scale.set(1, 1, depth / width);
            group.add(bodyMesh);

            group.add(
                mesh(new THREE.CylinderGeometry(capRadius, capRadius, capHeight, 16), capMat, {
                    position: { y: height / 2 + capHeight / 2 },
                })
            );

            group.rotation.set(Math.PI / 2, rotationY, 0, 'YXZ');
        },
    });
}
