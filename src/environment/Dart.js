import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

/**
 * Creates a throwing Dart stuck in the table.
 * Static clutter prop with basic physics bounds.
 */
export function createDart(scene, physicsWorld, position = { x: 2, y: -2.75, z: 2 }, rotationZ = Math.PI / 6) {
    const dartGroup = new THREE.Group();
    dartGroup.name = 'Dart';

    // Materials
    const metalMaterial = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.3,
        metalness: 0.9,
    });

    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x5c4033, // Dark wood
        roughness: 0.8,
        metalness: 0.1,
    });

    const flightMaterial = new THREE.MeshStandardMaterial({
        color: 0xcc0000, // Red flights
        roughness: 0.6,
        metalness: 0.0,
        side: THREE.DoubleSide
    });

    // 1. Metal Tip (Cone)
    const tipRadius = 0.02;
    const tipHeight = 0.3;
    const tipGeometry = new THREE.ConeGeometry(tipRadius, tipHeight, 8);
    const tipMesh = new THREE.Mesh(tipGeometry, metalMaterial);
    // Tip origin is at its base, cone points UP.
    // Shift tip down so the origin of the dart is at the very point of the tip.
    tipMesh.position.y = tipHeight / 2;
    dartGroup.add(tipMesh);

    // 2. Wooden Barrel (Cylinder)
    const barrelRadius = 0.04;
    const barrelHeight = 0.6;
    const barrelGeometry = new THREE.CylinderGeometry(barrelRadius, barrelRadius, barrelHeight, 8);
    const barrelMesh = new THREE.Mesh(barrelGeometry, woodMaterial);
    barrelMesh.position.y = tipHeight + (barrelHeight / 2);
    dartGroup.add(barrelMesh);

    // 3. Flight Shaft (Thin Cylinder)
    const shaftRadius = 0.015;
    const shaftHeight = 0.3;
    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftHeight, 8);
    const shaftMesh = new THREE.Mesh(shaftGeometry, metalMaterial);
    shaftMesh.position.y = tipHeight + barrelHeight + (shaftHeight / 2);
    dartGroup.add(shaftMesh);

    // 4. Flights (Thin Planes)
    const flightWidth = 0.2;
    const flightHeight = 0.2;
    const flightGeometry = new THREE.PlaneGeometry(flightWidth, flightHeight);

    // Flight 1
    const flight1 = new THREE.Mesh(flightGeometry, flightMaterial);
    flight1.position.y = tipHeight + barrelHeight + shaftHeight - (flightHeight / 2);
    flight1.position.x = flightWidth / 2;
    dartGroup.add(flight1);

    // Flight 2 (rotated 90 deg)
    const flight2 = new THREE.Mesh(flightGeometry, flightMaterial);
    flight2.position.y = tipHeight + barrelHeight + shaftHeight - (flightHeight / 2);
    flight2.position.z = flightWidth / 2;
    flight2.rotation.y = Math.PI / 2;
    dartGroup.add(flight2);

    // Flight 3
    const flight3 = new THREE.Mesh(flightGeometry, flightMaterial);
    flight3.position.y = tipHeight + barrelHeight + shaftHeight - (flightHeight / 2);
    flight3.position.x = -flightWidth / 2;
    dartGroup.add(flight3);

    // Flight 4
    const flight4 = new THREE.Mesh(flightGeometry, flightMaterial);
    flight4.position.y = tipHeight + barrelHeight + shaftHeight - (flightHeight / 2);
    flight4.position.z = -flightWidth / 2;
    flight4.rotation.y = Math.PI / 2;
    dartGroup.add(flight4);

    // Initial position & rotation
    // Rotate so it looks stuck in the table at an angle
    dartGroup.rotation.z = rotationZ;
    // Rotate around Y for variation
    dartGroup.rotation.y = Math.random() * Math.PI * 2;

    dartGroup.position.set(position.x, position.y, position.z);

    // Disable shadow casting for small details in main, but let's set it here just in case
    dartGroup.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = true;
        }
    });

    scene.add(dartGroup);

    // Physics
    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // Create a simple box bounding the whole dart
        // Height = tipHeight + barrelHeight + shaftHeight ~ 1.2
        const totalHeight = tipHeight + barrelHeight + shaftHeight;
        const boxWidth = flightWidth * 2;
        const boxDepth = flightWidth * 2;

        const shape = new Ammo.btBoxShape(new Ammo.btVector3(boxWidth / 2, totalHeight / 2, boxDepth / 2));

        // Since dartGroup origin is at the tip, we need to offset the physics shape
        // Or we just accept the collision box is a bit off center, or we make the transform.
        // `createStaticBody` expects the visual mesh center to align with the shape center.

        // To fix this, let's wrap dartGroup inside an outer group
        const wrapperGroup = new THREE.Group();
        wrapperGroup.position.copy(dartGroup.position);
        wrapperGroup.rotation.copy(dartGroup.rotation);

        dartGroup.position.set(0, -totalHeight / 2, 0);
        dartGroup.rotation.set(0, 0, 0); // Reset local rot

        wrapperGroup.add(dartGroup);
        scene.add(wrapperGroup); // Adding wrapper to scene instead of dartGroup

        const body = createStaticBody(physicsWorld, wrapperGroup, shape);
        wrapperGroup.userData.body = body;

        return { group: wrapperGroup };
    }

    return { group: dartGroup };
}
