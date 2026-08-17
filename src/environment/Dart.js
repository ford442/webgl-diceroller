import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

/**
 * Creates a throwing Dart stuck in the table.
 * Static clutter prop with basic physics bounds.
 */
export function createDart(
    scene,
    physicsWorld,
    position = { x: 2, y: -2.75, z: 2 },
    rotationZ = Math.PI / 6
) {
    const tipRadius = 0.02;
    const tipHeight = 0.3;
    const barrelRadius = 0.04;
    const barrelHeight = 0.6;
    const shaftRadius = 0.015;
    const shaftHeight = 0.3;
    const flightWidth = 0.2;
    const flightHeight = 0.2;
    const totalHeight = tipHeight + barrelHeight + shaftHeight;
    const boxWidth = flightWidth * 2;
    const boxDepth = flightWidth * 2;
    const dartRotationY = Math.random() * Math.PI * 2;

    return createProp(scene, physicsWorld, {
        name: 'Dart',
        position,
        colliders: [
            {
                type: 'box',
                halfExtents: [boxWidth / 2, totalHeight / 2, boxDepth / 2],
                offset: { y: totalHeight / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            group.rotation.set(0, dartRotationY, rotationZ);

            const metalMaterial = new THREE.MeshStandardMaterial({
                color: 0x888888,
                roughness: 0.3,
                metalness: 0.9,
            });

            const woodMaterial = new THREE.MeshStandardMaterial({
                color: 0x5c4033,
                roughness: 0.8,
                metalness: 0.1,
            });

            const flightMaterial = new THREE.MeshStandardMaterial({
                color: 0xcc0000,
                roughness: 0.6,
                metalness: 0.0,
                side: THREE.DoubleSide,
            });

            group.add(
                mesh(new THREE.ConeGeometry(tipRadius, tipHeight, 8), metalMaterial, {
                    position: { y: tipHeight / 2 },
                })
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(barrelRadius, barrelRadius, barrelHeight, 8),
                    woodMaterial,
                    { position: { y: tipHeight + barrelHeight / 2 } }
                )
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftHeight, 8),
                    metalMaterial,
                    { position: { y: tipHeight + barrelHeight + shaftHeight / 2 } }
                )
            );

            const flightY = tipHeight + barrelHeight + shaftHeight - flightHeight / 2;
            const flightGeo = new THREE.PlaneGeometry(flightWidth, flightHeight);

            group.add(
                mesh(flightGeo, flightMaterial, {
                    position: { x: flightWidth / 2, y: flightY },
                    castShadow: false,
                })
            );
            group.add(
                mesh(flightGeo, flightMaterial, {
                    position: { z: flightWidth / 2, y: flightY },
                    rotation: { y: Math.PI / 2 },
                    castShadow: false,
                })
            );
            group.add(
                mesh(flightGeo, flightMaterial, {
                    position: { x: -flightWidth / 2, y: flightY },
                    castShadow: false,
                })
            );
            group.add(
                mesh(flightGeo, flightMaterial, {
                    position: { z: -flightWidth / 2, y: flightY },
                    rotation: { y: Math.PI / 2 },
                    castShadow: false,
                })
            );

            group.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = true;
                }
            });
        },
    });
}
