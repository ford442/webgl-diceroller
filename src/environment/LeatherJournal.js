import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createLeatherJournal(scene, physicsWorld, position = { x: 0, y: -2.35, z: 0 }, rotationY = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'LeatherJournal';

    // Dimensions
    const width = 2.5;
    const height = 0.5;
    const depth = 3.5;

    // Materials
    // Leather Cover (Worn Brown Leather)
    const coverMat = new THREE.MeshStandardMaterial({
        color: 0x4a2e15, // Brown leather
        roughness: 0.8,
        metalness: 0.05
    });

    // Pages (Yellowed parchment)
    const pagesMat = new THREE.MeshStandardMaterial({
        color: 0xf5deb3,
        roughness: 0.9,
        metalness: 0.0
    });

    // Ribbon bookmark (Red)
    const ribbonMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000,
        roughness: 0.8,
        metalness: 0.0
    });

    // 1. Book Body (Cover)
    const coverGeo = new THREE.BoxGeometry(width, height, depth);
    const coverMesh = new THREE.Mesh(coverGeo, coverMat);
    coverMesh.castShadow = true;
    coverMesh.receiveShadow = true;
    group.add(coverMesh);

    // 2. Pages (Slightly smaller, inside cover)
    const pagesGeo = new THREE.BoxGeometry(width - 0.2, height - 0.1, depth - 0.1);
    const pagesMesh = new THREE.Mesh(pagesGeo, pagesMat);
    // Move slightly forward so spine is solid cover
    pagesMesh.position.set(0.1, 0, 0);
    pagesMesh.castShadow = true;
    pagesMesh.receiveShadow = true;
    group.add(pagesMesh);

    // 3. Bookmark Ribbon hanging out the bottom
    const ribbonGeo = new THREE.BoxGeometry(0.2, 0.02, 1.0);
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.position.set(0, -height/2 + 0.05, depth/2 + 0.3); // sticking out the bottom edge
    ribbonMesh.rotation.y = Math.PI / 12;
    ribbonMesh.castShadow = true;
    ribbonMesh.receiveShadow = true;
    group.add(ribbonMesh);

    // --- Position on Table ---
    // Table Top is generally y = -2.75 in main.js setup for props.
    // Assuming we pass in the centered height y = -2.75 + height/2
    group.position.set(position.x, position.y, position.z);
    group.rotation.set(0, rotationY, 0);

    scene.add(group);

    // --- Physics ---
    if (physicsWorld) {
        // Simple box shape for the journal
        const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, height/2, depth/2));
        createStaticBody(physicsWorld, group, shape);
    }

    return { group };
}
