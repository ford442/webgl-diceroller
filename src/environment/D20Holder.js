import * as THREE from 'three';
import { createProp, materials, mesh } from './propKit.js';

export function createD20Holder(
    scene,
    physicsWorld,
    position = { x: -2, y: -2.55, z: -4 },
    rotationY = 0,
    { scale = 1 } = {}
) {
    const radius = 0.8;
    const height = 0.4;

    return createProp(scene, physicsWorld, {
        name: 'D20Holder',
        position,
        rotation: rotationY,
        scale,
        colliders: [{ type: 'cylinder', radius, halfHeight: height / 2 }],
        build({ group }) {
            const baseGeo = new THREE.CylinderGeometry(radius, radius, height, 6);
            group.add(mesh(baseGeo, materials.darkLeather()));

            const indGeo = new THREE.CircleGeometry(0.5, 32);
            group.add(
                mesh(indGeo, materials.blackAccent(), {
                    rotation: { x: -Math.PI / 2 },
                    position: { y: height / 2 + 0.001 },
                })
            );
        },
    });
}
