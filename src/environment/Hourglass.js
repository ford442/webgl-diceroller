import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createHourglass(
    scene,
    physicsWorld,
    position = { x: -12, y: -1.75, z: -8 },
    rotationY = 0
) {
    const radius = 0.6;
    const height = 2.0;
    const plateHeight = 0.1;

    const result = createProp(scene, physicsWorld, {
        name: 'Hourglass',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const woodMat = materials.wood();
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                metalness: 0.1,
                roughness: 0.1,
                transmission: 0.9,
                transparent: true,
                thickness: 0.1,
                ior: 1.5,
            });
            const sandMat = new THREE.MeshStandardMaterial({
                color: 0xeedd82,
                roughness: 1.0,
            });

            const plateGeo = new THREE.CylinderGeometry(radius, radius, plateHeight, 6);
            group.add(
                mesh(plateGeo, woodMat, { position: { y: height / 2 - plateHeight / 2 } })
            );
            group.add(
                mesh(plateGeo, woodMat, { position: { y: -height / 2 + plateHeight / 2 } })
            );

            const rodGeo = new THREE.CylinderGeometry(0.05, 0.05, height - plateHeight * 2, 8);
            for (let i = 0; i < 3; i++) {
                const angle = ((Math.PI * 2) / 3) * i;
                const rDist = radius * 0.8;
                group.add(
                    mesh(rodGeo, woodMat, {
                        position: {
                            x: Math.cos(angle) * rDist,
                            z: Math.sin(angle) * rDist,
                        },
                    })
                );
            }

            const glassH = (height - plateHeight * 2) / 2 - 0.05;
            const coneGeo = new THREE.ConeGeometry(radius * 0.7, glassH, 32);

            const topBulb = mesh(coneGeo, glassMat, {
                rotation: { x: Math.PI },
                position: { y: glassH / 2 },
            });
            group.add(topBulb);

            const botBulb = mesh(coneGeo, glassMat, { position: { y: -glassH / 2 } });
            group.add(botBulb);

            const sandH = glassH * 0.5;
            group.add(
                mesh(new THREE.ConeGeometry(radius * 0.7 * 0.5, sandH, 32), sandMat, {
                    position: { y: -glassH + sandH / 2 },
                })
            );
            group.add(
                mesh(new THREE.CylinderGeometry(0.02, 0.02, glassH, 8), sandMat, {
                    position: { y: -glassH / 2 },
                })
            );
        },
    });

    return result.group;
}
