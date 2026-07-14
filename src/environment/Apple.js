import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createApple(scene, physicsWorld, position = { x: -3, y: -2.75, z: -3 }, rotationY = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Apple';

    // Apple body material
    const appleMat = new THREE.MeshStandardMaterial({
        color: 0xaa0000, // Deep red
        roughness: 0.4,
        metalness: 0.1
    });

    // Stem material
    const stemMat = new THREE.MeshStandardMaterial({
        color: 0x4a2f1d, // Dark brown
        roughness: 0.8,
        metalness: 0.0
    });

    // 1. Apple Body
    const radius = 0.25;
    // Sphere geometry for apple, slightly flattened at top/bottom
    const bodyGeo = new THREE.SphereGeometry(radius, 32, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, appleMat);
    bodyMesh.scale.set(1.0, 0.9, 1.0);
    // Move up so the bottom sits on y=0 relative to group
    bodyMesh.position.y = radius * 0.9;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // 2. Stem
    const stemHeight = 0.1;
    const stemGeo = new THREE.CylinderGeometry(0.015, 0.01, stemHeight, 8);
    const stemMesh = new THREE.Mesh(stemGeo, stemMat);
    // Position stem at top of apple, slightly tilted
    stemMesh.position.y = radius * 0.9 * 2; // top of apple
    stemMesh.position.x = 0.02;
    stemMesh.rotation.z = -Math.PI / 8;
    stemMesh.castShadow = true;
    group.add(stemMesh);

    // Position group in world
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics
    // Using btBoxShape as it's safe and verified in the codebase
    // Half-extents for the box encompassing the apple
    if (ammo && physicsWorld) {
        const halfExtents = new ammo.btVector3(radius, radius * 0.9 + (stemHeight / 2), radius);
        if (ammo && physicsWorld) {
            const shape = new ammo.btBoxShape(halfExtents);
        
            // Because the apple body sits above the group's origin (group.position is at the bottom),
            // we need to shift the physical shape up to match the visual mass.
            const proxyMesh = new THREE.Mesh();
            proxyMesh.position.copy(group.position);
            proxyMesh.position.y += radius * 0.9; // Shift center of mass up
            proxyMesh.rotation.copy(group.rotation);
        
            createStaticBody(physicsWorld, proxyMesh, shape);
        }
    }

    return group;
}
