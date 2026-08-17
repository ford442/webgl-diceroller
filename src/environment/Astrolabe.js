import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createAstrolabe(scene, physicsWorld, position, rotationY) {
    const baseRadius = 0.5;
    const baseHeight = 0.1;
    const supportHeight = 1.0;
    const ringRadius = 0.8;
    const ringTube = 0.04;
    const totalHeight = baseHeight + supportHeight + ringRadius;
    const collisionRadius = ringRadius * 1.1;

    const brassMaterial = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        roughness: 0.3,
        metalness: 0.8,
    });

    const darkBrassMaterial = new THREE.MeshStandardMaterial({
        color: 0x8a7b32,
        roughness: 0.4,
        metalness: 0.8,
    });

    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        roughness: 0.7,
        metalness: 0.9,
    });

    let innerRing1;
    let innerRing2;

    return createProp(scene, physicsWorld, {
        name: 'Astrolabe',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: collisionRadius,
                halfHeight: totalHeight / 2,
                offset: { y: totalHeight / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const ringCenterY = baseHeight + supportHeight / 2;

            group.add(
                mesh(
                    new THREE.CylinderGeometry(baseRadius, baseRadius * 1.2, baseHeight, 16),
                    ironMaterial,
                    { position: { y: baseHeight / 2 } }
                )
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.05, 0.05, supportHeight, 8), darkBrassMaterial, {
                    position: { y: baseHeight + supportHeight / 2 },
                })
            );

            const outerRing = mesh(
                new THREE.TorusGeometry(ringRadius, ringTube, 8, 32),
                brassMaterial,
                { position: { y: ringCenterY }, rotation: { y: Math.PI / 4 } }
            );
            group.add(outerRing);

            innerRing1 = mesh(
                new THREE.TorusGeometry(ringRadius * 0.85, ringTube * 0.9, 8, 32),
                darkBrassMaterial,
                {
                    position: { y: ringCenterY },
                    rotation: { x: Math.PI / 3, y: Math.PI / 6 },
                }
            );
            group.add(innerRing1);

            innerRing2 = mesh(
                new THREE.TorusGeometry(ringRadius * 0.7, ringTube * 0.8, 8, 32),
                brassMaterial,
                {
                    position: { y: ringCenterY },
                    rotation: { x: -Math.PI / 4, z: Math.PI / 6 },
                }
            );
            group.add(innerRing2);

            group.add(
                mesh(new THREE.SphereGeometry(0.1, 16, 16), brassMaterial, {
                    position: { y: ringCenterY },
                })
            );
        },
        update: (deltaTime, _elapsedTime) => {
            if (innerRing1 && innerRing2) {
                innerRing1.rotation.y += deltaTime * 0.2;
                innerRing2.rotation.z += deltaTime * 0.3;
                innerRing1.rotation.x += deltaTime * 0.1;
            }
        },
    });
}
