import * as THREE from 'three';
import { createProp, materials } from './propKit.js';

export function createBook(
    scene,
    physicsWorld,
    position = { x: -6, y: -2.5, z: -6 },
    rotationY = 0.2,
    { scale = 1 } = {}
) {
    const width = 3;
    const height = 0.5;
    const depth = 4;

    return createProp(scene, physicsWorld, {
        name: 'Book',
        position,
        rotation: rotationY,
        scale,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, height / 2, depth / 2],
                dynamic: true,
                mass: 0.3,
            },
        ],
        build({ group }) {
            const geometry = new THREE.BoxGeometry(width, height, depth);
            const bookMesh = new THREE.Mesh(geometry, materials.darkRed());
            bookMesh.castShadow = true;
            bookMesh.receiveShadow = true;
            group.add(bookMesh);
        },
    });
}
