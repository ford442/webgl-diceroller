import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createAmulet(
    scene,
    physicsWorld,
    position = { x: -6, y: -2.74, z: -8 },
    rotationY = Math.PI / 6
) {
    const radius = 0.4;
    const thickness = 0.05;
    const shapeRadius = radius + thickness;
    const shapeHeight = thickness * 2;

    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.9,
        roughness: 0.3,
    });

    const rubyMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xff0033,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.8,
        thickness: 0.2,
        ior: 1.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
    });

    const stringMaterial = new THREE.MeshStandardMaterial({
        color: 0x332211,
        roughness: 0.9,
        metalness: 0.0,
    });

    return createProp(scene, physicsWorld, {
        name: 'Amulet',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: shapeRadius,
                halfHeight: shapeHeight / 2,
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const ringGeometry = new THREE.TorusGeometry(radius, thickness, 16, 32);
            ringGeometry.rotateX(Math.PI / 2);
            group.add(mesh(ringGeometry, goldMaterial));

            const backingGeometry = new THREE.CylinderGeometry(radius, radius, thickness * 0.5, 32);
            group.add(
                mesh(backingGeometry, goldMaterial, { position: { y: -thickness * 0.5 } })
            );

            const gemGeometry = new THREE.CylinderGeometry(
                radius * 0.7,
                radius * 0.7,
                thickness * 1.5,
                8
            );
            group.add(mesh(gemGeometry, rubyMaterial));

            const loopGeometry = new THREE.TorusGeometry(0.08, 0.02, 8, 16);
            loopGeometry.rotateY(Math.PI / 2);
            group.add(
                mesh(loopGeometry, goldMaterial, { position: { x: 0, y: 0, z: -radius - 0.05 } })
            );

            const stringCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, -thickness, -radius - 0.1),
                new THREE.Vector3(0.2, -thickness, -radius - 0.5),
                new THREE.Vector3(-0.3, -thickness, -radius - 1.0),
                new THREE.Vector3(0.5, -thickness, -radius - 1.8),
                new THREE.Vector3(-0.1, -thickness, -radius - 2.5),
                new THREE.Vector3(0.3, -thickness, -radius - 3.2),
                new THREE.Vector3(0.0, -thickness, -radius - 3.5),
            ]);
            const stringGeometry = new THREE.TubeGeometry(stringCurve, 64, 0.02, 8, false);
            group.add(mesh(stringGeometry, stringMaterial));
        },
    });
}
