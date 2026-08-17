import * as THREE from 'three';
import { getWoodTextures } from '../core/TexturePipeline.js';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createLute(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    let resolvedPosition = { ...position };
    let resolvedRotation = rotationY;

    if (rotationY === 0 && position.x === 0 && position.y === 0) {
        resolvedPosition = { x: -8, y: -1.85, z: 2 };
        resolvedRotation = Math.PI / 6;
    }

    const result = createProp(scene, physicsWorld, {
        name: 'Lute',
        position: resolvedPosition,
        rotation: resolvedRotation,
        colliders: [
            {
                type: 'box',
                halfExtents: [1.5, 0.5, 2.5],
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const { diffuse: woodDiffuse, bump: woodBump, roughness: woodRoughness } =
                getWoodTextures();

            const woodMaterial = new THREE.MeshStandardMaterial({
                map: woodDiffuse,
                bumpMap: woodBump,
                bumpScale: 0.05,
                roughnessMap: woodRoughness,
                roughness: 0.6,
                color: 0xffcc88,
            });

            const darkWoodMaterial = new THREE.MeshStandardMaterial({
                map: woodDiffuse,
                bumpMap: woodBump,
                bumpScale: 0.05,
                roughnessMap: woodRoughness,
                roughness: 0.8,
                color: 0x3f1f1f,
            });

            const stringMaterial = new THREE.MeshStandardMaterial({
                color: 0xdddddd,
                metalness: 0.5,
                roughness: 0.2,
            });

            const blackMaterial = new THREE.MeshStandardMaterial({
                color: 0x111111,
                roughness: 0.9,
            });

            const bodyMesh = mesh(
                new THREE.SphereGeometry(1.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
                darkWoodMaterial,
                { rotation: { x: Math.PI / 2 } }
            );
            bodyMesh.scale.set(1, 1, 0.6);
            group.add(bodyMesh);

            const topMesh = mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.05, 32), woodMaterial, {
                position: { y: 0.025 },
            });
            topMesh.scale.set(1, 1, 0.6);
            group.add(topMesh);

            group.add(
                mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 32), blackMaterial, {
                    position: { y: 0.03, z: -0.4 },
                })
            );

            group.add(
                mesh(new THREE.BoxGeometry(1.2, 0.1, 0.2), darkWoodMaterial, {
                    position: { y: 0.1, z: 0.6 },
                })
            );

            const neckLen = 2.0;
            group.add(
                mesh(new THREE.BoxGeometry(0.4, 0.15, neckLen), darkWoodMaterial, {
                    position: { y: 0.05, z: -1.2 - neckLen / 2 },
                })
            );

            const numFrets = 8;
            for (let i = 0; i < numFrets; i++) {
                const fretZ = -1.2 - 0.2 - (i * (neckLen - 0.4)) / numFrets;
                group.add(
                    mesh(new THREE.BoxGeometry(0.42, 0.02, 0.02), stringMaterial, {
                        position: { y: 0.13, z: fretZ },
                    })
                );
            }

            const pegboxLen = 0.8;
            const pegboxMesh = mesh(new THREE.BoxGeometry(0.4, 0.2, pegboxLen), darkWoodMaterial);
            const pegboxZ = -1.2 - neckLen;
            pegboxMesh.position.set(
                0,
                -0.2,
                pegboxZ - (pegboxLen / 2) * Math.cos(Math.PI / 3)
            );
            pegboxMesh.rotation.x = -Math.PI / 3;
            group.add(pegboxMesh);

            for (let i = 0; i < 6; i++) {
                const pegMesh = mesh(
                    new THREE.CylinderGeometry(0.04, 0.02, 0.6, 8),
                    darkWoodMaterial,
                    { rotation: { z: Math.PI / 2 }, position: { z: (i - 2.5) * (pegboxLen / 6) } }
                );
                pegboxMesh.add(pegMesh);
            }

            const stringLen = 1.2 + neckLen - 0.6 + 0.2;
            for (let i = 0; i < 6; i++) {
                const offsetX = (i - 2.5) * 0.06;
                group.add(
                    mesh(new THREE.CylinderGeometry(0.005, 0.005, stringLen, 4), stringMaterial, {
                        rotation: { x: Math.PI / 2 },
                        position: { x: offsetX, y: 0.16, z: -0.2 - stringLen / 2 + 0.6 },
                    })
                );
            }
        },
    });

    return result.group;
}
