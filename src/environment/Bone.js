import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createBone(scene, physicsWorld, position = { x: 5, y: -2.75, z: 5 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'Bone';

    // Dimensions
    const shaftRadius = 0.15;
    const shaftLength = 1.5;
    const knuckleRadius = 0.25;

    // Bone Material (dusty off-white PBR)
    const boneMaterial = new THREE.MeshStandardMaterial({
        color: 0xe6e3d8, // Dusty off-white
        roughness: 0.9,  // Very rough, matte
        metalness: 0.0,
        bumpScale: 0.05
    });

    // --- Geometries ---
    // Shaft (middle part)
    const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16);
    const shaftMesh = new THREE.Mesh(shaftGeo, boneMaterial);
    shaftMesh.castShadow = true;
    shaftMesh.receiveShadow = true;
    group.add(shaftMesh);

    // Knuckles (two spheres at each end)
    const knuckleGeo = new THREE.SphereGeometry(knuckleRadius, 16, 16);

    // Top knuckles
    const topKnuckle1 = new THREE.Mesh(knuckleGeo, boneMaterial);
    topKnuckle1.position.set(-knuckleRadius * 0.6, shaftLength / 2, 0);
    topKnuckle1.castShadow = true;
    topKnuckle1.receiveShadow = true;
    group.add(topKnuckle1);

    const topKnuckle2 = new THREE.Mesh(knuckleGeo, boneMaterial);
    topKnuckle2.position.set(knuckleRadius * 0.6, shaftLength / 2, 0);
    topKnuckle2.castShadow = true;
    topKnuckle2.receiveShadow = true;
    group.add(topKnuckle2);

    // Bottom knuckles
    const bottomKnuckle1 = new THREE.Mesh(knuckleGeo, boneMaterial);
    bottomKnuckle1.position.set(-knuckleRadius * 0.6, -shaftLength / 2, 0);
    bottomKnuckle1.castShadow = true;
    bottomKnuckle1.receiveShadow = true;
    group.add(bottomKnuckle1);

    const bottomKnuckle2 = new THREE.Mesh(knuckleGeo, boneMaterial);
    bottomKnuckle2.position.set(knuckleRadius * 0.6, -shaftLength / 2, 0);
    bottomKnuckle2.castShadow = true;
    bottomKnuckle2.receiveShadow = true;
    group.add(bottomKnuckle2);

    // Lay flat on table
    // The cylinder is aligned along local Y.
    // Rotate around X by 90 degrees (Math.PI / 2) to lay flat.
    group.rotation.set(Math.PI / 2, rotationY, 0, 'YXZ');

    // Position on table
    // Since it lays flat, its height above table is knuckleRadius.
    group.position.set(position.x, position.y + knuckleRadius, position.z);

    scene.add(group);

    // --- Physics ---
    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // Approximate the entire bone with a btBoxShape to act as a static collider
        // Half-extents:
        // X = width of two knuckles = (knuckleRadius * 0.6 * 2 + knuckleRadius * 2) / 2
        //   = (0.3 + 0.5) / 2 = 0.4
        // Y = total length = (shaftLength + knuckleRadius * 2) / 2
        //   = (1.5 + 0.5) / 2 = 1.0
        // Z = depth of knuckle = knuckleRadius
        const halfX = knuckleRadius * 0.6 + knuckleRadius;
        const halfY = (shaftLength + knuckleRadius * 2) / 2;
        const halfZ = knuckleRadius;

        const shape = new Ammo.btBoxShape(new Ammo.btVector3(halfX, halfY, halfZ));

        // Use group as proxy for the static body
        createStaticBody(physicsWorld, group, shape);
    }

    return { group };
}
