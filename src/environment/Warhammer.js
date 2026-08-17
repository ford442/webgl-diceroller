import * as THREE from 'three';
import { createProp, materials, mesh } from './propKit.js';

export function createWarhammer(scene, physicsWorld, position, rotationAngle) {
    const handleLength = 6.0;
    const handleRadius = 0.2;
    const headWidth = 1.2;
    const headHeight = 1.2;
    const headDepth = 2.5;
    const pommelRadius = 0.3;

    const hx = (handleLength + pommelRadius * 2) / 2;
    const hy = headHeight / 2;
    const hz = headDepth / 2;

    return createProp(scene, physicsWorld, {
        name: 'Warhammer',
        position,
        rotation: rotationAngle,
        colliders: [
            {
                type: 'box',
                halfExtents: [hx, hy, hz],
                offset: { y: hy },
                materialTag: 3,
            },
        ],
        build({ group }) {
            group.add(
                mesh(
                    new THREE.CylinderGeometry(handleRadius, handleRadius * 0.9, handleLength, 16),
                    materials.wood(0x3d2314),
                    { rotation: { z: Math.PI / 2 }, position: { y: handleRadius } }
                )
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(handleRadius * 1.1, handleRadius * 1.1, 2.0, 16),
                    materials.leather(),
                    {
                        rotation: { z: Math.PI / 2 },
                        position: { x: -handleLength / 4, y: handleRadius },
                    }
                )
            );

            group.add(
                mesh(new THREE.BoxGeometry(headWidth, headHeight, headDepth), materials.iron(), {
                    position: { x: handleLength / 2, y: headHeight / 2 },
                })
            );

            group.add(
                mesh(new THREE.SphereGeometry(pommelRadius, 16, 16), materials.iron(), {
                    position: { x: -handleLength / 2, y: handleRadius },
                })
            );
        },
    });
}
