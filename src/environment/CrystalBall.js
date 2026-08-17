import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCrystalBall(
    scene,
    physicsWorld,
    position = { x: 12, y: -2.75, z: 0 },
    rotationY = 0
) {
    const ballRadius = 0.5;
    const standRadiusTop = 0.35;
    const standRadiusBot = 0.4;
    const baseHeight = 0.1;
    const stemHeight = 0.25;
    const ballCenterY = baseHeight + stemHeight + ballRadius * 0.7;

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        metalness: 0.8,
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.05,
        transmission: 0.9,
        thickness: 1.0,
        ior: 1.5,
        clearcoat: 1.0,
        transparent: true,
        side: THREE.DoubleSide,
    });

    const lightColor = 0xaa00ff;

    const result = createProp(scene, physicsWorld, {
        name: 'CrystalBall',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [ballRadius, ballRadius, ballRadius],
                offset: { y: ballCenterY },
                materialTag: STATIC_MATERIAL.METAL,
            },
            {
                type: 'cylinder',
                radius: standRadiusBot,
                halfHeight: baseHeight / 2,
                offset: { y: baseHeight / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            group.add(
                mesh(
                    new THREE.CylinderGeometry(
                        standRadiusBot * 0.8,
                        standRadiusBot,
                        baseHeight,
                        16
                    ),
                    goldMat,
                    { position: { y: baseHeight / 2 } }
                )
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.1, 0.15, stemHeight, 8), goldMat, {
                    position: { y: baseHeight + stemHeight / 2 },
                })
            );

            group.add(
                mesh(new THREE.TorusGeometry(standRadiusTop, 0.04, 8, 16), goldMat, {
                    position: { y: baseHeight + stemHeight },
                    rotation: { x: Math.PI / 2 },
                })
            );

            const ballMesh = mesh(new THREE.SphereGeometry(ballRadius, 32, 32), glassMat, {
                position: { y: ballCenterY },
            });
            group.add(ballMesh);

            const glowLight = new THREE.PointLight(lightColor, 2.0, 3.0);
            glowLight.position.set(0, ballCenterY, 0);
            glowLight.castShadow = false;
            group.add(glowLight);

            const coreMat = new THREE.MeshStandardMaterial({
                color: 0xff00ff,
                emissive: lightColor,
                emissiveIntensity: 2.0,
                roughness: 0.8,
                transparent: true,
                opacity: 0.8,
            });
            group.add(
                mesh(new THREE.IcosahedronGeometry(0.15, 0), coreMat, {
                    position: { y: ballCenterY },
                })
            );
        },
    });

    return result.group;
}
