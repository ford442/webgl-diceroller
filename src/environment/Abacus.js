import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createAbacus(
    scene,
    physicsWorld,
    position = { x: -3, y: -2.75, z: 2 },
    rotationY = Math.PI / 4
) {
    const frameWidth = 4.0;
    const frameHeight = 2.0;
    const frameThickness = 0.2;
    const railCount = 5;
    const beadCountPerRail = 10;
    const railRadius = 0.03;
    const beadOuterRadius = 0.15;
    const beadInnerRadius = 0.05;
    const railSpacing = (frameWidth - 0.4) / (railCount - 1);

    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x4a2e15,
        roughness: 0.7,
        metalness: 0.1,
    });

    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        metalness: 0.9,
        roughness: 0.3,
        envMapIntensity: 1.2,
    });

    const beadMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        metalness: 0.8,
        roughness: 0.4,
        envMapIntensity: 1.0,
    });

    return createProp(scene, physicsWorld, {
        name: 'Abacus',
        position,
        rotation: rotationY,
        footOffsetY: frameThickness / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [frameWidth / 2, frameHeight / 2, frameThickness / 2],
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            group.rotation.set(-Math.PI / 2, rotationY, 0, 'YXZ');

            const topBotGeo = new THREE.BoxGeometry(frameWidth, frameThickness, frameThickness);
            group.add(
                mesh(topBotGeo, woodMat, { position: { y: frameHeight / 2 - frameThickness / 2 } })
            );
            group.add(
                mesh(topBotGeo, woodMat, {
                    position: { y: -(frameHeight / 2 - frameThickness / 2) },
                })
            );

            const sideGeo = new THREE.BoxGeometry(frameThickness, frameHeight, frameThickness);
            group.add(
                mesh(sideGeo, woodMat, { position: { x: -(frameWidth / 2 - frameThickness / 2) } })
            );
            group.add(
                mesh(sideGeo, woodMat, { position: { x: frameWidth / 2 - frameThickness / 2 } })
            );

            const railGeo = new THREE.CylinderGeometry(
                railRadius,
                railRadius,
                frameHeight - frameThickness * 2,
                8
            );
            const beadGeo = new THREE.TorusGeometry(beadOuterRadius, beadInnerRadius, 8, 16);

            for (let i = 0; i < railCount; i++) {
                const railX = -(frameWidth / 2) + 0.2 + i * railSpacing;

                group.add(mesh(railGeo, brassMat, { position: { x: railX } }));

                const railLength = frameHeight - frameThickness * 2;
                const availableSpace = railLength - beadOuterRadius * 2 * beadCountPerRail;
                let currentY = -(railLength / 2) + beadOuterRadius;

                for (let j = 0; j < beadCountPerRail; j++) {
                    const extraSpace = (Math.random() * availableSpace) / beadCountPerRail;
                    currentY += extraSpace;

                    group.add(
                        mesh(beadGeo, beadMat, {
                            position: { x: railX, y: currentY, z: 0 },
                            rotation: {
                                x: Math.PI / 2,
                                y: (Math.random() - 0.5) * 0.2,
                                z: (Math.random() - 0.5) * 0.2,
                            },
                        })
                    );

                    currentY += beadOuterRadius * 2;
                }
            }
        },
    });
}
