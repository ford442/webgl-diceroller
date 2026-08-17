import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createApple(
    scene,
    physicsWorld,
    position = { x: -3, y: -2.75, z: -3 },
    rotationY = 0
) {
    const radius = 0.25;
    const stemHeight = 0.1;
    const bodyCenterY = radius * 0.9;

    const appleMat = new THREE.MeshStandardMaterial({
        color: 0xaa0000,
        roughness: 0.4,
        metalness: 0.1,
    });

    const stemMat = new THREE.MeshStandardMaterial({
        color: 0x4a2f1d,
        roughness: 0.8,
        metalness: 0.0,
    });

    const result = createProp(scene, physicsWorld, {
        name: 'Apple',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [radius, radius * 0.9 + stemHeight / 2, radius],
                offset: { y: bodyCenterY },
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const bodyGeo = new THREE.SphereGeometry(radius, 32, 16);
            const bodyMesh = mesh(bodyGeo, appleMat);
            bodyMesh.scale.set(1.0, 0.9, 1.0);
            bodyMesh.position.y = bodyCenterY;
            group.add(bodyMesh);

            const stemGeo = new THREE.CylinderGeometry(0.015, 0.01, stemHeight, 8);
            group.add(
                mesh(stemGeo, stemMat, {
                    position: { x: 0.02, y: bodyCenterY * 2 },
                    rotation: { z: -Math.PI / 8 },
                })
            );
        },
    });

    return result.group;
}
