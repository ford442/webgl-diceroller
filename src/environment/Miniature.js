import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createMiniature(
    scene,
    physicsWorld,
    position = { x: 10, y: -2.75, z: -8 },
    rotationY = 0
) {
    const baseRadius = 0.4;
    const baseHeight = 0.1;
    const bodyHeight = 0.8;
    const headRadius = 0.25;
    const totalHeight = baseHeight + bodyHeight + headRadius * 2;

    createProp(scene, physicsWorld, {
        name: 'Miniature',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: baseRadius,
                halfHeight: totalHeight / 2,
                offset: { y: totalHeight / 2 },
                materialTag: STATIC_MATERIAL.DEFAULT,
            },
        ],
        build({ group }) {
            const baseMat = new THREE.MeshStandardMaterial({
                color: 0x111111,
                roughness: 0.9,
            });
            const bodyMat = new THREE.MeshStandardMaterial({
                color: 0x888888,
                roughness: 0.6,
                metalness: 0.3,
            });
            const bodyRadius = 0.2;

            group.add(
                mesh(new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 16), baseMat, {
                    position: { y: baseHeight / 2 },
                })
            );
            group.add(
                mesh(
                    new THREE.CylinderGeometry(bodyRadius * 0.5, bodyRadius, bodyHeight, 16),
                    bodyMat,
                    { position: { y: baseHeight + bodyHeight / 2 } }
                )
            );
            group.add(
                mesh(new THREE.SphereGeometry(headRadius, 16, 16), bodyMat, {
                    position: { y: baseHeight + bodyHeight + headRadius },
                })
            );
        },
    });
}
