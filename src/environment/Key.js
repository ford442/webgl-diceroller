import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createKey(
    scene,
    physicsWorld,
    position = { x: 6, y: -2.75, z: 8 },
    rotationY = Math.PI / 4
) {
    const shaftLength = 2.0;
    const shaftRadius = 0.15;
    const bowRadius = 0.6;
    const bitDepth = 0.6;

    const minX = -(shaftLength / 2 + bowRadius + shaftRadius);
    const maxX = shaftLength / 2 + 0.3;
    const maxZ = bitDepth + shaftRadius + 0.3;
    const sizeX = maxX - minX;
    const sizeY = (bowRadius + shaftRadius) * 2;
    const sizeZ = maxZ + bowRadius + shaftRadius;
    const centerX = (minX + maxX) / 2;
    const centerZ = (maxZ - (bowRadius + shaftRadius)) / 2;

    return createProp(scene, physicsWorld, {
        name: 'Key',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [sizeX / 2, sizeY / 2, sizeZ / 2],
                offset: { x: centerX, y: 0, z: centerZ },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const ironMaterial = materials.iron();

            const shaftGeometry = new THREE.CylinderGeometry(
                shaftRadius,
                shaftRadius,
                shaftLength,
                16
            );
            shaftGeometry.rotateZ(Math.PI / 2);
            group.add(mesh(shaftGeometry, ironMaterial));

            const bowGeometry = new THREE.TorusGeometry(bowRadius, shaftRadius, 16, 32);
            bowGeometry.rotateX(Math.PI / 2);
            group.add(
                mesh(bowGeometry, ironMaterial, {
                    position: { x: -(shaftLength / 2 + bowRadius) },
                })
            );

            const bitWidth = 0.4;
            const bitHeight = 0.15;
            group.add(
                mesh(new THREE.BoxGeometry(bitWidth, bitHeight, bitDepth), ironMaterial, {
                    position: { x: shaftLength / 2 - 0.3, z: bitDepth / 2 + shaftRadius },
                })
            );

            const cutOutGeometry = new THREE.BoxGeometry(0.15, bitHeight + 0.05, 0.3);
            group.add(
                mesh(cutOutGeometry, ironMaterial, {
                    position: { x: shaftLength / 2 - 0.2, z: bitDepth + shaftRadius },
                })
            );
            group.add(
                mesh(cutOutGeometry, ironMaterial, {
                    position: { x: shaftLength / 2 - 0.45, z: bitDepth + shaftRadius },
                })
            );
        },
    });
}
