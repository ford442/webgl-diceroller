import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createDragonScale(
    scene,
    physicsWorld,
    position = { x: 10, y: -2.75, z: -12 },
    rotationY = 0
) {
    const radius = 0.5;
    const height = 0.1;

    return createProp(scene, physicsWorld, {
        name: 'DragonScale',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [radius, height / 2, radius * 1.5],
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const geometry = new THREE.ConeGeometry(radius, height, 16);
            geometry.scale(1, 1, 1.5);

            const material = new THREE.MeshStandardMaterial({
                color: 0x8b0000,
                metalness: 0.8,
                roughness: 0.2,
                envMapIntensity: 1.2,
            });

            group.add(mesh(geometry, material));
        },
    });
}
