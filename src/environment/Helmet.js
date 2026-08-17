import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createHelmet(
    scene,
    physicsWorld,
    position = { x: -16, y: -2.75, z: 8 },
    rotationY = 0
) {
    const helmetRadius = 0.8;
    const helmetHeight = 0.9;
    const physRadius = helmetRadius + 0.05;
    const centerShift = helmetHeight / 2;

    return createProp(scene, physicsWorld, {
        name: 'IronHelmet',
        position,
        rotation: rotationY,
        footOffsetY: centerShift,
        colliders: [
            {
                type: 'cylinder',
                radius: physRadius,
                halfHeight: helmetHeight / 2,
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const ironMat = materials.iron();
            const darkIronMat = materials.iron();
            darkIronMat.color.setHex(0x333333);
            const boneMat = new THREE.MeshStandardMaterial({
                color: 0xddddcc,
                roughness: 0.8,
                metalness: 0.1,
            });
            const goldMat = materials.gold();

            const domeMesh = mesh(
                new THREE.SphereGeometry(helmetRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
                ironMat,
                { position: { y: 0.4 - centerShift } }
            );
            group.add(domeMesh);

            const ringMesh = mesh(
                new THREE.CylinderGeometry(helmetRadius, helmetRadius, 0.4, 32, 1, true),
                ironMat,
                { position: { y: 0.2 - centerShift } }
            );
            ringMesh.material.side = THREE.DoubleSide;
            group.add(ringMesh);

            group.add(
                mesh(new THREE.TorusGeometry(helmetRadius, 0.05, 16, 32), darkIronMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { y: 0.05 - centerShift },
                })
            );

            group.add(
                mesh(new THREE.TorusGeometry(helmetRadius + 0.01, 0.04, 16, 32), goldMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { y: 0.4 - centerShift },
                })
            );

            group.add(
                mesh(new THREE.BoxGeometry(0.2, 0.6, 0.1), goldMat, {
                    position: { y: 0.4 - centerShift, z: helmetRadius + 0.02 },
                })
            );

            const hornGeo = new THREE.ConeGeometry(0.2, 0.8, 16);
            const leftHorn = mesh(hornGeo, boneMat, {
                position: { x: -helmetRadius - 0.1, y: 0.7 - centerShift },
                rotation: { z: Math.PI / 4 },
            });
            group.add(leftHorn);

            const rightHorn = mesh(hornGeo, boneMat, {
                position: { x: helmetRadius + 0.1, y: 0.7 - centerShift },
                rotation: { z: -Math.PI / 4 },
            });
            group.add(rightHorn);

            const hornBaseGeo = new THREE.TorusGeometry(0.22, 0.05, 16, 16);
            group.add(
                mesh(hornBaseGeo, goldMat, {
                    position: { x: -helmetRadius + 0.02, y: 0.55 - centerShift },
                    rotation: { y: Math.PI / 2, x: -Math.PI / 4 },
                })
            );
            group.add(
                mesh(hornBaseGeo, goldMat, {
                    position: { x: helmetRadius - 0.02, y: 0.55 - centerShift },
                    rotation: { y: Math.PI / 2, x: Math.PI / 4 },
                })
            );
        },
    });
}
