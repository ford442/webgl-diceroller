import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createMug(scene, physicsWorld, position = { x: 4, y: -2.75, z: 2 }, rotationY = Math.PI / 4) {
    const mugGroup = new THREE.Group();

    // Dimensions
    const radius = 0.5;
    const height = 1.2;
    const thickness = 0.1;

    // Materials
    const clayMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b, // Dark brown clay/ceramic
        roughness: 0.8,
        metalness: 0.1
    });

    const innerMaterial = new THREE.MeshStandardMaterial({
        color: 0x3d2314, // Darker inside, maybe some dried liquid
        roughness: 0.9,
        metalness: 0.0
    });

    // 1. Mug Body (Outer)
    const bodyGeometry = new THREE.CylinderGeometry(radius, radius, height, 32);
    const bodyMesh = new THREE.Mesh(bodyGeometry, clayMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;

    // 2. Mug Inner (to make it look hollow)
    const innerRadius = radius - thickness;
    const innerDepth = height - thickness;
    const innerGeometry = new THREE.CylinderGeometry(innerRadius, innerRadius, innerDepth, 32);
    const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial);
    innerMesh.position.y = thickness / 2 + 0.01; // slightly up to prevent z-fighting at bottom

    // Create a group for body + inner, wait, easier to just use a LatheGeometry or CSG.
    // We'll just stick to a solid cylinder for physics, but visually it's a bit tricky without CSG to make it truly hollow.
    // Instead, we can place the innerMesh slightly higher to act as the "liquid" or base inside.
    bodyMesh.add(innerMesh);

    // 3. Mug Handle
    const handleRadius = 0.3;
    const handleTube = 0.08;
    const handleGeometry = new THREE.TorusGeometry(handleRadius, handleTube, 16, 32);
    const handleMesh = new THREE.Mesh(handleGeometry, clayMaterial);

    // Position the handle on the side
    handleMesh.position.set(radius + handleTube, 0, 0);
    // Rotate so it's vertically aligned
    // By default Torus is flat on XY plane, we want it sticking out along X.
    handleMesh.rotation.y = Math.PI / 2;
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;

    // Assemble
    mugGroup.add(bodyMesh);
    mugGroup.add(handleMesh);

    // Position and Rotate the whole group
    // The cylinder center is at its middle (y = 0), so we shift it up by height/2
    // position.y should be the bottom of the mug resting on the table.
    mugGroup.position.set(position.x, position.y + height / 2, position.z);
    mugGroup.rotation.y = rotationY;

    // Add to scene
    scene.add(mugGroup);

    // Physics
    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // We'll use a simple cylinder shape for the collision bounds
        const shape = new Ammo.btCylinderShape(new Ammo.btVector3(radius, height / 2, radius));

        // Use the mugGroup for transformation
        const body = createStaticBody(physicsWorld, mugGroup, shape);

        // Store body reference
        mugGroup.userData.body = body;
    }

    return { group: mugGroup };
}
