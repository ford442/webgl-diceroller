import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createDragonScale(scene, physicsWorld, position = { x: 10, y: -2.75, z: -12 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'DragonScale';

    // Geometry: A flattened cone for a scale shape
    const radius = 0.5;
    const height = 0.1;
    const geometry = new THREE.ConeGeometry(radius, height, 16);

    // Scale is usually flattened
    geometry.scale(1, 1, 1.5);

    // Enhanced Material: Shiny, metallic scaled material
    const material = new THREE.MeshStandardMaterial({
        color: 0x8b0000, // Dark red
        metalness: 0.8,
        roughness: 0.2,
        envMapIntensity: 1.2
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Position on table
    // Table Top -2.75.
    // The geometry is centered in the group (mostly).
    // Let's place it slightly above the table to avoid z-fighting.
    group.position.set(position.x, position.y + (height / 2), position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics
    const ammo = getAmmo();
    const shape = new ammo.btBoxShape(new ammo.btVector3(radius, height / 2, radius * 1.5));

    createStaticBody(physicsWorld, group, shape);

    return { group };
}
