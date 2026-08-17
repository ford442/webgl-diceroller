import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createBone(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 5 },
    rotationY = 0
) {
    const shaftRadius = 0.15;
    const shaftLength = 1.5;
    const knuckleRadius = 0.25;
    const halfX = knuckleRadius * 0.6 + knuckleRadius;
    const halfY = (shaftLength + knuckleRadius * 2) / 2;
    const halfZ = knuckleRadius;

    const boneMaterial = new THREE.MeshStandardMaterial({
        color: 0xe6e3d8,
        roughness: 0.9,
        metalness: 0.0,
        bumpScale: 0.05,
    });

    return createProp(scene, physicsWorld, {
        name: 'Bone',
        position,
        rotation: rotationY,
        footOffsetY: knuckleRadius,
        colliders: [
            {
                type: 'box',
                halfExtents: [halfX, halfY, halfZ],
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            group.rotation.set(Math.PI / 2, rotationY, 0, 'YXZ');

            const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16);
            group.add(mesh(shaftGeo, boneMaterial));

            const knuckleGeo = new THREE.SphereGeometry(knuckleRadius, 16, 16);

            group.add(
                mesh(knuckleGeo, boneMaterial, {
                    position: { x: -knuckleRadius * 0.6, y: shaftLength / 2, z: 0 },
                })
            );
            group.add(
                mesh(knuckleGeo, boneMaterial, {
                    position: { x: knuckleRadius * 0.6, y: shaftLength / 2, z: 0 },
                })
            );
            group.add(
                mesh(knuckleGeo, boneMaterial, {
                    position: { x: -knuckleRadius * 0.6, y: -shaftLength / 2, z: 0 },
                })
            );
            group.add(
                mesh(knuckleGeo, boneMaterial, {
                    position: { x: knuckleRadius * 0.6, y: -shaftLength / 2, z: 0 },
                })
            );
        },
    });
}
