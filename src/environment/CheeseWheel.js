import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCheeseWheel(
    scene,
    physicsWorld,
    position = { x: 12, y: -2.75, z: 8 },
    rotationY = 0
) {
    const radius = 0.8;
    const height = 0.4;

    const material = new THREE.MeshStandardMaterial({
        color: 0xfada5e,
        roughness: 0.6,
        metalness: 0.0,
        bumpScale: 0.02,
    });

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.arc(0, 0, radius, 0, Math.PI * 1.7, false);
    shape.lineTo(0, 0);

    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.05,
        bevelThickness: 0.05,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -height / 2, 0);

    return createProp(scene, physicsWorld, {
        name: 'CheeseWheel',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            group.add(mesh(geometry, material));
        },
    });
}
