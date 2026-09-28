import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createGemstone(
    scene,
    physicsWorld,
    position = { x: -5, y: -2.25, z: 0 },
    rotationY = 0,
    { scale = 1 } = {}
) {
    const radius = 0.5;

    return createProp(scene, physicsWorld, {
        name: 'Gemstone',
        position,
        rotation: rotationY,
        scale,
        colliders: [
            {
                type: 'box',
                halfExtents: [radius * 0.8, radius * 0.8, radius * 0.8],
                dynamic: true,
                mass: 0.15,
            },
        ],
        build({ group }) {
            const geometry = new THREE.OctahedronGeometry(radius, 0);
            const material = new THREE.MeshPhysicalMaterial({
                color: 0xff0000,
                emissive: 0x330000,
                emissiveIntensity: 0.2,
                metalness: 0.1,
                roughness: 0.0,
                transmission: 0.8,
                thickness: 0.5,
                ior: 1.76,
                clearcoat: 1.0,
                clearcoatRoughness: 0.0,
                transparent: true,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        },
    });
}
