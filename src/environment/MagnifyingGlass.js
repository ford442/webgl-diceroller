import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createMagnifyingGlass(scene, physicsWorld, position = { x: 0, y: -2.75, z: 0 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'MagnifyingGlass';

    const ammo = getAmmo();

    // --- Materials ---
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass
        metalness: 1.0,
        roughness: 0.2,
        envMapIntensity: 1.2
    });

    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033, // Dark Wood
        roughness: 0.7,
        metalness: 0.0
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0,
        transmission: 0.95,
        transparent: true,
        ior: 1.5,
        thickness: 0.1
    });

    // --- Dimensions ---
    const handleLength = 1.0;
    const handleRadius = 0.08;
    const connectorLength = 0.2;
    const connectorRadius = 0.05;
    const rimOuterRadius = 0.6;
    const rimTube = 0.04;
    const lensRadius = rimOuterRadius - rimTube;
    const lensThickness = 0.05;

    // Total length along Z axis
    const totalLength = handleLength + connectorLength + (rimOuterRadius * 2);
    // Offset to center the group on the Z axis
    const zOffset = -(totalLength / 2) + handleLength + connectorLength + rimOuterRadius;

    // --- Geometries & Meshes ---

    // 1. Handle (Wood)
    const handleGeo = new THREE.CylinderGeometry(handleRadius, handleRadius, handleLength, 16);
    const handleMesh = new THREE.Mesh(handleGeo, woodMat);
    handleMesh.rotation.x = Math.PI / 2;
    handleMesh.position.set(0, 0, -(handleLength / 2) - connectorLength - rimOuterRadius + zOffset);
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;
    group.add(handleMesh);

    // 2. Connector (Brass)
    const connectorGeo = new THREE.CylinderGeometry(connectorRadius, connectorRadius, connectorLength, 16);
    const connectorMesh = new THREE.Mesh(connectorGeo, brassMat);
    connectorMesh.rotation.x = Math.PI / 2;
    connectorMesh.position.set(0, 0, -(connectorLength / 2) - rimOuterRadius + zOffset);
    connectorMesh.castShadow = true;
    connectorMesh.receiveShadow = true;
    group.add(connectorMesh);

    // 3. Rim (Brass)
    const rimGeo = new THREE.TorusGeometry(rimOuterRadius, rimTube, 16, 32);
    const rimMesh = new THREE.Mesh(rimGeo, brassMat);
    // Torus is created in XY plane. Rotate to lie flat (XZ plane).
    // The handle goes along Z, so we don't need to rotate the rim if we want it to lie flat,
    // wait, if handle is along Z, and we want it flat on the table, the rim should be in the XZ plane.
    // By default, Torus is in XY. So rotate around X by 90 deg.
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.set(0, 0, zOffset);
    rimMesh.castShadow = true;
    rimMesh.receiveShadow = true;
    group.add(rimMesh);

    // 4. Lens (Glass)
    const lensGeo = new THREE.CylinderGeometry(lensRadius, lensRadius, lensThickness, 32);
    const lensMesh = new THREE.Mesh(lensGeo, glassMat);
    // Cylinder is Y-up. Rotate to lie flat in XZ.
    // wait, if we don't rotate, the cylinder face is in XZ plane.
    // So we don't need to rotate the cylinder geometry.
    lensMesh.position.set(0, 0, zOffset);
    // lensMesh.castShadow = true; // Glass shouldn't cast dark shadow
    lensMesh.receiveShadow = true;
    group.add(lensMesh);

    // --- Positioning & Rotation ---
    // Make it lie flat on the table.
    // Thickness of the object is roughly the maximum of handleRadius, rimTube, lensThickness.
    // The max is handleRadius (0.08).
    // So the group center should be at tableHeight + maxRadius.
    group.position.set(position.x, position.y + handleRadius, position.z);

    // Initial rotation (mostly around Y to orient on table)
    group.rotation.set(0, rotationY, 0);

    scene.add(group);

    // --- Physics ---
    // A box shape that encompasses the whole object
    // Width (X) = rim diameter
    // Height (Y) = thickness (max radius * 2)
    // Length (Z) = totalLength
    if (ammo && physicsWorld) {
        const shape = new ammo.btBoxShape(new ammo.btVector3(rimOuterRadius, handleRadius, totalLength / 2));
    
        // Note: createStaticBody assumes the group origin is the center of mass.
        // Our zOffset calculation above should have centered the geometry within the group.
        createStaticBody(physicsWorld, group, shape);
    }

    return group;
}
