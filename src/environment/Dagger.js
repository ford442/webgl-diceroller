import * as THREE from 'three';
import { getSteelMaterial, getGoldMaterial, getLeatherMaterial } from '../core/MaterialPalette.js';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createDagger(
    scene,
    physicsWorld,
    position = { x: 8, y: -2.45, z: 8 },
    rotationY = Math.PI / 4
) {
    const steelMaterial = getSteelMaterial();
    const goldMaterial = getGoldMaterial();
    const leatherMaterial = getLeatherMaterial();

    const result = createProp(scene, physicsWorld, {
        name: 'Dagger',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [1.25, 0.2, 4.0],
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            group.add(
                mesh(new THREE.BoxGeometry(0.8, 0.1, 5.0), steelMaterial, {
                    position: { z: 2.5 },
                })
            );

            group.add(mesh(new THREE.BoxGeometry(2.5, 0.2, 0.4), goldMaterial));

            const handle = mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.0, 8), leatherMaterial, {
                position: { z: -1.2 },
            });
            handle.rotation.x = Math.PI / 2;
            group.add(handle);

            group.add(
                mesh(new THREE.SphereGeometry(0.4, 16, 16), goldMaterial, { position: { z: -2.4 } })
            );
        },
    });

    return result.group;
}
