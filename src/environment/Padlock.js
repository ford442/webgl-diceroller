import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createPadlock(
    scene,
    physicsWorld,
    position = { x: 0, y: -2.75, z: 0 },
    rotationY = 0
) {
    const bodyWidth = 1.2;
    const bodyHeight = 1.0;
    const bodyDepth = 0.4;
    const shackleRadius = 0.4;
    const shackleTube = 0.15;
    const physWidth = bodyWidth;
    const physHeight = bodyDepth;
    const physDepth = bodyHeight + shackleRadius + shackleTube;
    const zOffset = -(shackleRadius / 2);

    createProp(scene, physicsWorld, {
        name: 'Padlock',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [physWidth / 2, physHeight / 2, physDepth / 2],
                offset: { y: physHeight / 2, z: zOffset },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const ironMaterial = materials.iron();
            ironMaterial.color.setHex(0x222222);
            ironMaterial.roughness = 0.8;
            ironMaterial.metalness = 0.6;

            const holeMaterial = new THREE.MeshStandardMaterial({
                color: 0x050505,
                roughness: 1.0,
                metalness: 0.0,
            });

            group.add(
                mesh(new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth), ironMaterial, {
                    position: { y: bodyDepth / 2 },
                })
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), holeMaterial, {
                    position: { y: bodyDepth + 0.01, z: 0.1 },
                })
            );
            group.add(
                mesh(new THREE.BoxGeometry(0.1, 0.05, 0.2), holeMaterial, {
                    position: { y: bodyDepth + 0.01, z: -0.05 },
                })
            );

            const shackleMesh = mesh(
                new THREE.TorusGeometry(shackleRadius, shackleTube, 12, 24, Math.PI),
                ironMaterial,
                { rotation: { x: Math.PI / 2 }, position: { y: bodyDepth / 2, z: -bodyHeight / 2 } }
            );
            group.add(shackleMesh);

            const legGeo = new THREE.CylinderGeometry(shackleTube, shackleTube, 0.3, 12);
            group.add(
                mesh(legGeo, ironMaterial, {
                    rotation: { x: Math.PI / 2 },
                    position: {
                        x: -shackleRadius,
                        y: bodyDepth / 2,
                        z: -bodyHeight / 2 + 0.15,
                    },
                })
            );
            group.add(
                mesh(legGeo, ironMaterial, {
                    rotation: { x: Math.PI / 2 },
                    position: {
                        x: shackleRadius,
                        y: bodyDepth / 2,
                        z: -bodyHeight / 2 + 0.15,
                    },
                })
            );

            group.rotation.x = (Math.random() - 0.5) * 0.1;
            group.rotation.z = (Math.random() - 0.5) * 0.1;
        },
    });
}
