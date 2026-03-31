import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createPadlock(scene, physicsWorld, position = { x: 0, y: -2.75, z: 0 }, rotationY = 0) {
    const ammo = getAmmo();

    // Group
    const padlockGroup = new THREE.Group();
    padlockGroup.name = 'Padlock';
    padlockGroup.position.set(position.x, position.y, position.z);
    padlockGroup.rotation.y = rotationY;

    // --- Materials ---
    // Dark, slightly rusted iron for the padlock body and shackle
    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x222222, // Dark gray/black
        roughness: 0.8,  // Rough, weathered
        metalness: 0.6,  // Metallic but dull
    });

    // A slightly darker/different material for the keyhole interior
    const holeMaterial = new THREE.MeshStandardMaterial({
        color: 0x050505,
        roughness: 1.0,
        metalness: 0.0
    });

    // --- Geometry ---

    // 1. Padlock Body
    // Dimensions: width, height, depth
    const bodyWidth = 1.2;
    const bodyHeight = 1.0;
    const bodyDepth = 0.4;

    const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
    const bodyMesh = new THREE.Mesh(bodyGeo, ironMaterial);

    // The table surface is at Y = -2.75
    // The padlock is resting on its back (so depth is the vertical axis).
    // Let's rotate the whole group so it lies flat on the table.

    // Position body center so the back rests at Y=0 relative to the group
    bodyMesh.position.set(0, bodyDepth / 2, 0);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    padlockGroup.add(bodyMesh);

    // 2. Keyhole
    // A simple shape for the keyhole on the front face
    const holeGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16);
    const holeMesh = new THREE.Mesh(holeGeo, holeMaterial);
    // Position on top of the body (which is facing up)
    holeMesh.position.set(0, bodyDepth + 0.01, 0.1);
    // Wait, if it's lying flat, the "front" of the body is facing UP (Y axis).
    holeMesh.rotation.x = Math.PI / 2; // Point cylinder up
    // Wait, cylinder defaults to Y axis. So if the face is pointing UP (Y axis), cylinder should not be rotated to face up, it already faces up.
    holeMesh.rotation.x = 0;

    // Adjust keyhole position to be embedded in the front face
    holeMesh.position.set(0, bodyDepth + 0.01, 0.1);
    padlockGroup.add(holeMesh);

    const holeStemGeo = new THREE.BoxGeometry(0.1, 0.05, 0.2);
    const holeStemMesh = new THREE.Mesh(holeStemGeo, holeMaterial);
    holeStemMesh.position.set(0, bodyDepth + 0.01, -0.05);
    padlockGroup.add(holeStemMesh);

    // 3. Shackle
    // The curved top part of the lock
    // It should be attached to the "top" edge of the body.
    // Since the padlock is lying down, the "top" edge is along the Z or X axis depending on orientation.
    // Let's make the top edge face negative Z.
    const shackleRadius = 0.4;
    const shackleTube = 0.15;

    // Torus defaults to XY plane.
    const shackleGeo = new THREE.TorusGeometry(shackleRadius, shackleTube, 12, 24, Math.PI);
    const shackleMesh = new THREE.Mesh(shackleGeo, ironMaterial);

    // We want the shackle to protrude from the top of the body.
    // Let's position it at the "top" edge of the padlock body (Z = -bodyHeight/2).
    // The open ends of the half-torus should point into the body.
    // Torus drawn from 0 to PI goes through positive Y.
    // We need to rotate it so the ends point towards positive Z (into the body).
    // And it needs to lie flat on the table, so the torus plane should be XZ.
    shackleMesh.rotation.x = Math.PI / 2;

    // Now the half-circle curves out into negative Z.
    // Let's adjust position.
    // Body is centered at (0, bodyDepth/2, 0).
    // The top edge of the body is at Z = -bodyHeight/2 = -0.5.
    shackleMesh.position.set(0, bodyDepth / 2, -bodyHeight / 2);
    shackleMesh.castShadow = true;
    shackleMesh.receiveShadow = true;
    padlockGroup.add(shackleMesh);

    // The straight legs of the shackle (to connect torus to body)
    const legLength = 0.3;
    const legGeo = new THREE.CylinderGeometry(shackleTube, shackleTube, legLength, 12);

    const leftLeg = new THREE.Mesh(legGeo, ironMaterial);
    // Cylinder defaults to Y axis. Rotate to align with Z axis.
    leftLeg.rotation.x = Math.PI / 2;
    leftLeg.position.set(-shackleRadius, bodyDepth / 2, -bodyHeight / 2 + legLength / 2);
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;
    padlockGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, ironMaterial);
    rightLeg.rotation.x = Math.PI / 2;
    rightLeg.position.set(shackleRadius, bodyDepth / 2, -bodyHeight / 2 + legLength / 2);
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;
    padlockGroup.add(rightLeg);

    // Add a slight tilt to the padlock to make it look naturally dropped
    padlockGroup.rotation.x = (Math.random() - 0.5) * 0.1;
    padlockGroup.rotation.z = (Math.random() - 0.5) * 0.1;

    scene.add(padlockGroup);

    // --- Physics ---
    if (ammo) {
        // We'll create a simple box collider that roughly covers the whole padlock (body + shackle)
        // Total depth (in local Z): bodyHeight (1.0) + shackle protruding (~0.4 + 0.15) ≈ 1.55.
        // Total width (local X): bodyWidth (1.2)
        // Total height (local Y): bodyDepth (0.4)

        const physWidth = bodyWidth;
        const physHeight = bodyDepth; // Lying flat
        const physDepth = bodyHeight + shackleRadius + shackleTube;

        const shape = new ammo.btBoxShape(new ammo.btVector3(physWidth / 2, physHeight / 2, physDepth / 2));

        // Center the physics body roughly over the padlock group
        // The shackle shifts the center of mass slightly into negative Z.
        const zOffset = - (shackleRadius / 2);

        // We'll attach the physics body to a proxy mesh to handle the offset properly
        const proxyGeo = new THREE.BoxGeometry(physWidth, physHeight, physDepth);
        const proxyMesh = new THREE.Mesh(proxyGeo);
        proxyMesh.visible = false;

        // Local position offset
        proxyMesh.position.set(0, physHeight / 2, zOffset);
        padlockGroup.add(proxyMesh);

        // createStaticBody handles world position/rotation of the mesh
        createStaticBody(physicsWorld, proxyMesh, shape);
    }
}
