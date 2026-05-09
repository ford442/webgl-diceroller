import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createPocketFlask(scene, physicsWorld, position = { x: 5, y: -2.75, z: 5 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'PocketFlask';

    const width = 1.0;
    const height = 1.5;
    const depth = 0.4;

    const capRadius = 0.15;
    const capHeight = 0.3;

    // Materials
    // A scratched pewter/silver metallic look
    const flaskMat = new THREE.MeshStandardMaterial({
        color: 0x999999, // Pewter
        roughness: 0.6,
        metalness: 0.8
    });

    const capMat = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa, // Slightly shinier silver
        roughness: 0.4,
        metalness: 0.9
    });

    // 1. Flask Body
    // Using a CylinderGeometry squashed on the Z axis
    const bodyGeo = new THREE.CylinderGeometry(width / 2, width / 2, height, 32);
    const bodyMesh = new THREE.Mesh(bodyGeo, flaskMat);
    // Squash the depth
    bodyMesh.scale.set(1, 1, depth / width);
    // Cylinder is Y-up, center is at local origin.
    // Shift it up so bottom rests at Y=0
    bodyMesh.position.y = height / 2;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // 2. Cap
    const capGeo = new THREE.CylinderGeometry(capRadius, capRadius, capHeight, 16);
    const capMesh = new THREE.Mesh(capGeo, capMat);
    // Cap on top of the flask
    capMesh.position.y = height + (capHeight / 2);
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    group.add(capMesh);

    // Position on table
    group.position.set(position.x, position.y, position.z);

    // The group rotation on the table, it can be standing up or laying down.
    // Let's lay it down, so it won't be knocked over easily, or let's have it standing?
    // It's a tavern table, let's have it slightly angled laying down.
    // Wait, let's lay it completely flat:
    group.rotation.x = Math.PI / 2; // Flat on the table
    group.rotation.z = rotationY;   // Rotate it horizontally

    // But if we rotate the group by PI/2 on X, the Y-axis of the cylinder becomes the Z-axis of the world.
    // The visual mesh was positioned such that the bottom was at Y=0.
    // If we rotate the group by PI/2 around X, local Y points along world Z.
    // Local Z (thickness) points along world -Y.
    // This means it will sink into the table!
    // To lay it flat on the table and rest properly, the "depth/2" must be the height from the table.

    // Let's adjust the group.children to be centered around the origin,
    // so when we rotate the group, it just rotates around its center of mass.
    bodyMesh.position.y = 0; // centered
    capMesh.position.y = (height / 2) + (capHeight / 2);

    // Now if it's laying flat (rotation.x = PI/2), the thickness (Z-axis locally) is vertical.
    // Local Z extends from -depth/2 to depth/2.
    // We want the lowest point (-depth/2) to be at table height (position.y).
    // So the group needs to be raised by depth/2.

    group.position.set(position.x, position.y + (depth / 2), position.z);

    // Randomly laying on the table
    group.rotation.set(Math.PI / 2, rotationY, 0, 'YXZ');

    scene.add(group);

    // Physics
    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // We'll use a BoxShape for the body that is centered at the group origin
        // Half extents
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(width / 2, height / 2, depth / 2));

        createStaticBody(physicsWorld, group, shape);
    }

    return { group };
}
