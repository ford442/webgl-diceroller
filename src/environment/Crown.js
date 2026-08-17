import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCrown(
    scene,
    physicsWorld,
    position = { x: -14, y: -2.75, z: 6 },
    rotationY = 0
) {
    const radiusTop = 0.9;
    const radiusBottom = 0.8;
    const height = 1.0;
    const yShift = -height / 2;

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 1.0,
        roughness: 0.3,
    });

    const velvetMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000,
        roughness: 0.9,
        metalness: 0.1,
    });

    const rubyMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000,
        metalness: 0.2,
        roughness: 0.1,
        transmission: 0.8,
        ior: 1.76,
        clearcoat: 1.0,
        transparent: true,
    });

    const sapphireMat = new THREE.MeshPhysicalMaterial({
        color: 0x0f52ba,
        metalness: 0.2,
        roughness: 0.1,
        transmission: 0.8,
        ior: 1.76,
        clearcoat: 1.0,
        transparent: true,
    });

    return createProp(scene, physicsWorld, {
        name: 'KingsCrown',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'cylinder',
                radius: radiusTop,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            group.add(
                mesh(new THREE.CylinderGeometry(radiusBottom + 0.05, radiusBottom, 0.3, 32), goldMat, {
                    position: { y: 0.15 + yShift },
                })
            );

            const domeMesh = mesh(
                new THREE.SphereGeometry(radiusBottom - 0.05, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
                velvetMat,
                { position: { y: 0.2 + yShift } }
            );
            domeMesh.scale.y = 1.2;
            group.add(domeMesh);

            const numSpikes = 8;
            for (let i = 0; i < numSpikes; i++) {
                const angle = (i / numSpikes) * Math.PI * 2;
                const px = Math.cos(angle) * radiusBottom;
                const pz = Math.sin(angle) * radiusBottom;

                const spikeMesh = mesh(
                    new THREE.ConeGeometry(0.15, height - 0.2, 16),
                    goldMat,
                    {
                        position: { x: px, y: 0.3 + (height - 0.2) / 2 + yShift, z: pz },
                        rotation: { x: 0, y: -angle + Math.PI / 2, z: 0.2 },
                    }
                );

                const isRuby = i % 2 === 0;
                const gemMesh = mesh(
                    new THREE.SphereGeometry(0.08, 16, 16),
                    isRuby ? rubyMat : sapphireMat,
                    { position: { y: (height - 0.2) / 2 + 0.05 } }
                );
                spikeMesh.add(gemMesh);
                group.add(spikeMesh);

                group.add(
                    mesh(
                        new THREE.BoxGeometry(0.15, 0.15, 0.05),
                        isRuby ? sapphireMat : rubyMat,
                        {
                            position: {
                                x: Math.cos(angle) * (radiusBottom + 0.06),
                                y: 0.15 + yShift,
                                z: Math.sin(angle) * (radiusBottom + 0.06),
                            },
                            rotation: { y: -angle + Math.PI / 2 },
                        }
                    )
                );
            }

            const crossY = 0.2 + (radiusBottom - 0.05) * 1.2 + 0.1 + yShift;
            group.add(
                mesh(new THREE.TorusGeometry(0.1, 0.03, 16, 32), goldMat, {
                    position: { y: crossY },
                    rotation: { x: Math.PI / 2 },
                })
            );
            group.add(mesh(new THREE.SphereGeometry(0.05), rubyMat, { position: { y: crossY } }));
        },
    });
}
