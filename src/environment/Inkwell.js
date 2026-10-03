import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createInkwell(
    scene,
    physicsWorld,
    position = { x: -8, y: -2.75, z: -10 },
    rotationY = 0
) {
    const radius = 0.25;
    const height = 0.4;

    const baseGeometry = new THREE.CylinderGeometry(radius, radius * 1.1, height, 16);
    const lidGeometry = new THREE.CylinderGeometry(radius * 0.8, radius * 0.9, 0.1, 16);

    // Position geometry appropriately
    baseGeometry.translate(0, height / 2, 0);
    lidGeometry.translate(0, height + 0.05, 0);

    const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x111111,
        transmission: 0.8,
        opacity: 1,
        metalness: 0,
        roughness: 0.1,
        ior: 1.5,
        thickness: 0.1,
        transparent: true,
    });

    const brassMaterial = materials.brass();

    return createProp(scene, physicsWorld, {
        name: 'Inkwell',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: radius * 1.1,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.GLASS,
            },
        ],
        build({ group }) {
            const baseMesh = mesh(baseGeometry, glassMaterial);
            const lidMesh = mesh(lidGeometry, brassMaterial);
            group.add(baseMesh);
            group.add(lidMesh);
        },
    });
}
