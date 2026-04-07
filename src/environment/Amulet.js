import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createAmulet(scene, physicsWorld, position = { x: -6, y: -2.74, z: -8 }, rotationY = Math.PI / 6) {
    const group = new THREE.Group();
    group.name = 'Amulet';

    // Materials
    // Gold casing
    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.9,
        roughness: 0.3,
    });

    // Glowing/Shiny Ruby center
    const rubyMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xff0033,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.8,
        thickness: 0.2,
        ior: 1.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1
    });

    // Chain/String material
    const stringMaterial = new THREE.MeshStandardMaterial({
        color: 0x332211, // Dark leather/twine
        roughness: 0.9,
        metalness: 0.0
    });

    // 1. Amulet Base (Gold Ring)
    // The amulet lies flat on the table, so its local Y axis points UP.
    // A cylinder with low height is a coin-like shape.
    const radius = 0.4;
    const thickness = 0.05;

    // Create the outer ring using Torus for a rounded edge
    const ringGeometry = new THREE.TorusGeometry(radius, thickness, 16, 32);
    // Torus default orientation is upright (facing Z). We rotate it to lie flat.
    ringGeometry.rotateX(Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeometry, goldMaterial);
    ringMesh.castShadow = true;
    ringMesh.receiveShadow = true;
    group.add(ringMesh);

    // 2. Amulet Backing (Flat gold disc inside the ring)
    const backingGeometry = new THREE.CylinderGeometry(radius, radius, thickness * 0.5, 32);
    const backingMesh = new THREE.Mesh(backingGeometry, goldMaterial);
    // Offset slightly down so it sits at the bottom of the ring
    backingMesh.position.y = -thickness * 0.5;
    backingMesh.castShadow = true;
    backingMesh.receiveShadow = true;
    group.add(backingMesh);

    // 3. Gemstone Center
    const gemGeometry = new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, thickness * 1.5, 8); // Octagonal gem
    const gemMesh = new THREE.Mesh(gemGeometry, rubyMaterial);
    gemMesh.castShadow = true;
    gemMesh.receiveShadow = true;
    group.add(gemMesh);

    // 4. Little loop at the top for the chain
    const loopGeometry = new THREE.TorusGeometry(0.08, 0.02, 8, 16);
    loopGeometry.rotateY(Math.PI / 2); // Rotate so the hole is horizontal
    const loopMesh = new THREE.Mesh(loopGeometry, goldMaterial);
    loopMesh.position.set(0, 0, -radius - 0.05); // Position at the "top" (negative Z in flat space)
    loopMesh.castShadow = true;
    loopMesh.receiveShadow = true;
    group.add(loopMesh);

    // 5. Chain/String (A squiggly path lying on the table)
    // Create a curved path for the string
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
    const stringMesh = new THREE.Mesh(stringGeometry, stringMaterial);
    stringMesh.castShadow = true;
    stringMesh.receiveShadow = true;
    group.add(stringMesh);

    // Set Group Position and Rotation
    group.position.set(position.x, position.y, position.z);
    group.rotation.set(0, rotationY, 0);

    scene.add(group);

    // Physics
    if (physicsWorld) {
        const AmmoInstance = getAmmo();

        // Use a simple flat cylinder shape for the main amulet body
        const shapeRadius = radius + thickness; // encompass the ring
        const shapeHeight = thickness * 2; // thin

        // btCylinderShape expects a vector of half-extents.
        // For a Y-axis cylinder, it's (radius, halfHeight, radius).
        const shape = new AmmoInstance.btCylinderShape(
            new AmmoInstance.btVector3(shapeRadius, shapeHeight / 2, shapeRadius)
        );

        // createStaticBody handles position/rotation from the group
        createStaticBody(physicsWorld, group, shape);
    }

    return { group };
}
