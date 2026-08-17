import * as THREE from 'three';
import { createProp } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createChair(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    const seatHeight = 6.5;
    const seatWidth = 3.5;
    const seatDepth = 3.5;
    const legWidth = 0.4;
    const backHeight = 5.0;
    const totalHeight = seatHeight + backHeight;

    return createProp(scene, physicsWorld, {
        name: 'Chair',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [
                    seatWidth / 2,
                    seatHeight / 2 + backHeight / 2,
                    seatDepth / 2,
                ],
                offset: { y: totalHeight / 2 },
            },
        ],
        build({ group }) {
            const { diffuse: woodDiffuse, bump: woodBump, roughness: woodRoughness } =
                getWoodTextures();

            const material = new THREE.MeshStandardMaterial({
                map: woodDiffuse,
                bumpMap: woodBump,
                bumpScale: 0.05,
                roughnessMap: woodRoughness,
                roughness: 0.8,
                color: 0x553311,
            });

            const seatGeo = new THREE.BoxGeometry(seatWidth, 0.3, seatDepth);
            const seat = new THREE.Mesh(seatGeo, material);
            seat.position.y = seatHeight;
            seat.castShadow = true;
            seat.receiveShadow = true;
            group.add(seat);

            const legGeo = new THREE.BoxGeometry(legWidth, seatHeight, legWidth);
            const positions = [
                { x: -seatWidth / 2 + legWidth / 2, z: -seatDepth / 2 + legWidth / 2 },
                { x: seatWidth / 2 - legWidth / 2, z: -seatDepth / 2 + legWidth / 2 },
                { x: -seatWidth / 2 + legWidth / 2, z: seatDepth / 2 - legWidth / 2 },
                { x: seatWidth / 2 - legWidth / 2, z: seatDepth / 2 - legWidth / 2 },
            ];

            positions.forEach((pos) => {
                const leg = new THREE.Mesh(legGeo, material);
                leg.position.set(pos.x, seatHeight / 2, pos.z);
                leg.castShadow = true;
                leg.receiveShadow = true;
                group.add(leg);
            });

            const backSupportGeo = new THREE.BoxGeometry(legWidth, backHeight, legWidth);
            const backPlankGeo = new THREE.BoxGeometry(seatWidth, 1.5, 0.2);
            const rearPositions = [
                { x: -seatWidth / 2 + legWidth / 2, z: -seatDepth / 2 + legWidth / 2 },
                { x: seatWidth / 2 - legWidth / 2, z: -seatDepth / 2 + legWidth / 2 },
            ];

            rearPositions.forEach((pos) => {
                const support = new THREE.Mesh(backSupportGeo, material);
                support.position.set(pos.x, seatHeight + backHeight / 2, pos.z);
                support.castShadow = true;
                support.receiveShadow = true;
                group.add(support);
            });

            const plank1 = new THREE.Mesh(backPlankGeo, material);
            plank1.position.set(0, seatHeight + backHeight - 0.5, -seatDepth / 2 + legWidth / 2);
            plank1.castShadow = true;
            group.add(plank1);

            const plank2 = new THREE.Mesh(backPlankGeo, material);
            plank2.position.set(0, seatHeight + backHeight / 2, -seatDepth / 2 + legWidth / 2);
            plank2.castShadow = true;
            group.add(plank2);
        },
    });
}
