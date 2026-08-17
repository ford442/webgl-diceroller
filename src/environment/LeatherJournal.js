import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createLeatherJournal(
    scene,
    physicsWorld,
    position = { x: -4, y: -2.75, z: 2 },
    rotationY = Math.PI / 8
) {
    const width = 2.5;
    const height = 0.6;
    const depth = 3.5;

    return createProp(scene, physicsWorld, {
        name: 'LeatherJournal',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, height / 2, depth / 2],
                materialTag: STATIC_MATERIAL.LEATHER,
            },
        ],
        build({ group }) {
            const coverMat = new THREE.MeshStandardMaterial({
                color: 0x4a2e15,
                roughness: 0.8,
                metalness: 0.05,
                bumpScale: 0.02,
            });
            const pagesMat = new THREE.MeshStandardMaterial({
                color: 0xeeddcc,
                roughness: 0.9,
                metalness: 0.0,
            });
            const ribbonMat = new THREE.MeshStandardMaterial({
                color: 0x8b0000,
                roughness: 0.7,
                metalness: 0.1,
            });

            const pagesWidth = width - 0.2;
            const pagesHeight = height - 0.1;
            const pagesDepth = depth - 0.2;
            group.add(
                mesh(new THREE.BoxGeometry(pagesWidth, pagesHeight, pagesDepth), pagesMat, {
                    position: { x: 0.1 },
                })
            );

            const coverThickness = 0.05;
            const boardGeo = new THREE.BoxGeometry(width, coverThickness, depth);
            group.add(
                mesh(boardGeo, coverMat, { position: { y: pagesHeight / 2 + coverThickness / 2 } })
            );
            group.add(
                mesh(boardGeo, coverMat, {
                    position: { y: -(pagesHeight / 2 + coverThickness / 2) },
                })
            );

            const spineWidth = 0.2;
            group.add(
                mesh(new THREE.BoxGeometry(spineWidth, height, depth), coverMat, {
                    position: { x: -width / 2 + spineWidth / 2 },
                })
            );

            const ribbonWidth = 0.3;
            const ribbonLength = 1.0;
            group.add(
                mesh(
                    new THREE.BoxGeometry(ribbonWidth, 0.01, ribbonLength),
                    ribbonMat,
                    {
                        position: { x: 0.5, y: -height / 2 + 0.05, z: depth / 2 + ribbonLength / 2 - 0.1 },
                        rotation: { x: -0.2 },
                    }
                )
            );
        },
    });
}
