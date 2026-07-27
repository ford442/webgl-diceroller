import * as THREE from 'three';
import { createProp, materials, mesh } from './propKit.js';

export function createHorseshoe(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotation = 0
) {
    const radius = 0.8;
    const tube = 0.15;
    const arc = Math.PI * 1.4;

    return createProp(scene, physicsWorld, {
        name: 'Horseshoe',
        position,
        rotation,
        colliders: [{ type: 'box', halfExtents: [1.0, 0.15, 1.0] }],
        build({ group }) {
            const geometry = new THREE.TorusGeometry(radius, tube, 8, 24, arc);
            group.add(
                mesh(geometry, materials.rustedIron(), {
                    rotation: { x: Math.PI / 2, z: Math.PI / 2 },
                })
            );
        },
    });
}
