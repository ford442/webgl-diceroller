import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createKey(scene, physicsWorld, position = { x: 6, y: -2.75, z: 8 }, rotationY = Math.PI / 4) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    // Rusty Iron Material
    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.8,
        metalness: 0.7,
    });

    // 1. Shaft (Cylinder)
    const shaftLength = 2.0;
    const shaftRadius = 0.15;
    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16);
    // Rotate cylinder to lie flat along the X axis
    shaftGeometry.rotateZ(Math.PI / 2);
    const shaft = new THREE.Mesh(shaftGeometry, ironMaterial);
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    // 2. Bow/Head (Torus)
    const bowRadius = 0.6;
    const bowTube = 0.15;
    const bowGeometry = new THREE.TorusGeometry(bowRadius, bowTube, 16, 32);
    // Position bow at the end of the shaft
    // Rotate torus to lie flat on the table
    bowGeometry.rotateX(Math.PI / 2);
    const bow = new THREE.Mesh(bowGeometry, ironMaterial);
    bow.position.set(-(shaftLength / 2 + bowRadius), 0, 0);
    bow.castShadow = true;
    bow.receiveShadow = true;
    group.add(bow);

    // 3. Bit/Teeth (Box)
    const bitWidth = 0.4;
    const bitHeight = 0.15;
    const bitDepth = 0.6;
    const bitGeometry = new THREE.BoxGeometry(bitWidth, bitHeight, bitDepth);
    const bit = new THREE.Mesh(bitGeometry, ironMaterial);
    // Position bit near the other end of the shaft, sticking out to the side
    bit.position.set((shaftLength / 2) - 0.3, 0, bitDepth / 2 + shaftRadius);
    bit.castShadow = true;
    bit.receiveShadow = true;
    group.add(bit);

    // Additional intricate cut-out on bit
    const cutOutGeometry = new THREE.BoxGeometry(0.15, bitHeight + 0.05, 0.3);
    const cutOut1 = new THREE.Mesh(cutOutGeometry, ironMaterial);
    cutOut1.position.set((shaftLength / 2) - 0.2, 0, bitDepth + shaftRadius);
    cutOut1.castShadow = true;
    cutOut1.receiveShadow = true;
    group.add(cutOut1);

    const cutOut2 = new THREE.Mesh(cutOutGeometry, ironMaterial);
    cutOut2.position.set((shaftLength / 2) - 0.45, 0, bitDepth + shaftRadius);
    cutOut2.castShadow = true;
    cutOut2.receiveShadow = true;
    group.add(cutOut2);

    scene.add(group);

    // --- Physics ---
    if (physicsWorld && getAmmo()) {
        // Calculate bounding box for physics shape
        const box3 = new THREE.Box3().setFromObject(group);
        const size = new THREE.Vector3();
        box3.getSize(size);

        // Ammo Box Shape uses half extents
        if (ammo && physicsWorld) {
            const halfExtents = new ammo.btVector3(size.x * 0.5, size.y * 0.5, size.z * 0.5);
            if (ammo && physicsWorld) {
                const shape = new ammo.btBoxShape(halfExtents);
        
                // Center physics body at the center of the bounding box
                const center = new THREE.Vector3();
                box3.getCenter(center);
        
                // Since the mesh is created around the origin but offset components,
                // we'll center the physics body using the visual center.
                // `createStaticBody` expects a mesh object with position and quaternion.
                const dummyMesh = new THREE.Mesh();
                dummyMesh.position.copy(center);
                dummyMesh.quaternion.copy(group.quaternion); // Actually we should use group quaternion
        
                createStaticBody(physicsWorld, dummyMesh, shape);
            }
        }
    }

    return {
        group
    };
}
