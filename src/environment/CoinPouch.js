import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createCoinPouch(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'CoinPouch';

    const ammo = getAmmo();

    // Material: Leather
    const leatherMat = new THREE.MeshStandardMaterial({
        color: 0x5c3a21, // Dark brown leather
        roughness: 0.9,
        metalness: 0.0
    });

    // Material: Tie / String
    const stringMat = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b, // Lighter brown
        roughness: 1.0,
        metalness: 0.0
    });

    // 1. Pouch Body (Lathe Geometry for a sack shape)
    const points = [];
    points.push(new THREE.Vector2(0, 0)); // Bottom center
    points.push(new THREE.Vector2(0.4, 0.05)); // Bottom curve
    points.push(new THREE.Vector2(0.6, 0.2)); // Bulge bottom
    points.push(new THREE.Vector2(0.65, 0.5)); // Bulge middle
    points.push(new THREE.Vector2(0.5, 0.8)); // Neck start
    points.push(new THREE.Vector2(0.3, 0.9)); // Neck narrow
    points.push(new THREE.Vector2(0.4, 1.0)); // Top flare
    points.push(new THREE.Vector2(0.45, 1.1)); // Top edge
    points.push(new THREE.Vector2(0.4, 1.1)); // Inner edge
    points.push(new THREE.Vector2(0.2, 0.9)); // Inner neck
    points.push(new THREE.Vector2(0, 0.8)); // Inside center

    const bodyGeo = new THREE.LatheGeometry(points, 32);
    const bodyMesh = new THREE.Mesh(bodyGeo, leatherMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // 2. Tie (Torus around the neck)
    const tieGeo = new THREE.TorusGeometry(0.32, 0.04, 8, 32);
    const tieMesh = new THREE.Mesh(tieGeo, stringMat);
    tieMesh.rotation.x = Math.PI / 2;
    tieMesh.position.y = 0.9;
    tieMesh.castShadow = true;
    tieMesh.receiveShadow = true;
    group.add(tieMesh);

    // 3. String ends (hanging down)
    const stringGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8);

    const string1 = new THREE.Mesh(stringGeo, stringMat);
    string1.position.set(0.3, 0.7, 0.1);
    string1.rotation.z = -Math.PI / 8;
    string1.rotation.x = Math.PI / 16;
    string1.castShadow = true;
    group.add(string1);

    const string2 = new THREE.Mesh(stringGeo, stringMat);
    string2.position.set(0.3, 0.7, -0.1);
    string2.rotation.z = -Math.PI / 8;
    string2.rotation.x = -Math.PI / 16;
    string2.castShadow = true;
    group.add(string2);


    // Position on table
    // Table Top -2.75.
    // Pouch base is at 0. Group Y should be -2.75.
    group.position.set(-4.5, -2.75, 2.5);
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    // Approximating with a Cylinder for simplicity
    // The bag is about 1.1 units high, max radius is 0.65.
    const radius = 0.65;
    const height = 1.1;

    // Physics center needs to be at the center of the cylinder.
    // Since the group's origin is at the bottom (y=0), we should ideally offset the body
    // but createStaticBody uses the group's position for the center of mass.
    // A quick way is to offset the visual meshes so the group is centered,
    // but the bag sits fine if we just use a slightly taller shape or shift the mesh down inside the group.

    // Let's adjust the group to be centered to match Ammo's expectations
    group.position.y = -2.75 + height / 2;
    bodyMesh.position.y -= height / 2;
    tieMesh.position.y -= height / 2;
    string1.position.y -= height / 2;
    string2.position.y -= height / 2;

    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height / 2, radius));
    createStaticBody(physicsWorld, group, shape);
}
