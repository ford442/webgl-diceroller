import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createSpellbook(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Spellbook';

    // Dimensions
    const width = 3.5;
    const height = 0.8;
    const depth = 4.5;

    // Materials
    // Leather Cover (Dark Blue/Purple with gold trim)
    const coverMat = new THREE.MeshStandardMaterial({
        color: 0x2b1b54, // Deep purple/blue
        roughness: 0.7,
        metalness: 0.1
    });

    // Gold Trim
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        metalness: 0.8
    });

    // Pages (Yellowed parchment)
    const pagesMat = new THREE.MeshStandardMaterial({
        color: 0xf5deb3,
        roughness: 0.9,
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

    // 3. Decorative Gold Trim (Strap/Clasp)
    const claspGeo = new THREE.BoxGeometry(0.5, height + 0.02, 1.0);
    const claspMesh = new THREE.Mesh(claspGeo, goldMat);
    claspMesh.position.set(width/2 - 0.25, 0, 0); // Front edge
    claspMesh.castShadow = true;
    claspMesh.receiveShadow = true;
    group.add(claspMesh);
    
    // 4. Glowing Arcane Symbol on Cover
    const symbolGroup = new THREE.Group();
    // Use simple primitives for a symbol
    const circleGeo = new THREE.TorusGeometry(0.8, 0.05, 8, 32);
    const glowMat = new THREE.MeshStandardMaterial({
        color: 0x00ffff, // Cyan glow
        emissive: 0x0088ff,
        emissiveIntensity: 0.8,
        roughness: 0.2
    });
    const circleMesh = new THREE.Mesh(circleGeo, glowMat);
    circleMesh.rotation.x = -Math.PI / 2;
    symbolGroup.add(circleMesh);
    
    // Triangle inside circle
    const triGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.05, 3);
    const triMesh = new THREE.Mesh(triGeo, glowMat);
    // Align with surface
    // Cylinder is Y-up, scale Y to be flat, we did that with radius.
    // Rotate to lie flat on the cover.
    // Cylinder default is standing.
    // Just place it flat
    triMesh.rotation.set(0, Math.PI/2, 0);
    symbolGroup.add(triMesh);

    symbolGroup.position.set(0, height/2 + 0.01, 0); // Just above cover
    group.add(symbolGroup);

    // Add a very subtle point light for the glow
    const bookLight = new THREE.PointLight(0x0088ff, 0.5, 3);
    bookLight.position.set(0, height/2 + 0.2, 0);
    group.add(bookLight);

    // --- Position on Table ---
    // Table Top -2.75.
    // Center Y = -2.75 + height/2 = -2.75 + 0.4 = -2.35.
    
    // Position somewhere interesting, near the crystal ball or other edge
    group.position.set(-8, -2.35, 6);
    // Slightly rotated
    group.rotation.set(0, Math.PI / 4, 0);

    scene.add(group);

    // --- Physics ---
    // Simple box shape for the book
    const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, height/2, depth/2));
    createStaticBody(physicsWorld, group, shape);

    return { group };
}
