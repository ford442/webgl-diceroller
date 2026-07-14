import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createSword(scene, physicsWorld, position = { x: -8, y: -2.45, z: 8 }, rotationY = -Math.PI / 4) {
    const group = new THREE.Group();

    // Materials
    const steelMaterial = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        metalness: 0.9,
        roughness: 0.2
    });

    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.8,
        roughness: 0.3
    });

    const leatherMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a2c21,
        roughness: 0.95
    });

    // Adjust all Z positions so the center of the bounding box is around Z = 0
    // Total length is roughly 16 units, from -4 to +12. Center is around +4.
    // We will shift all children by Z = -4 so the group origin matches the center of the physics box.
    const centerOffsetZ = -4.0;

    // 1. Blade
    // Long, flat, slightly tapered
    const bladeGeo = new THREE.BoxGeometry(1.2, 0.15, 12.0);
    const blade = new THREE.Mesh(bladeGeo, steelMaterial);
    blade.position.z = 6.0 + centerOffsetZ; // Extends forward
    blade.castShadow = true;
    blade.receiveShadow = true;
    group.add(blade);

    // 2. Crossguard
    const guardGeo = new THREE.BoxGeometry(4.0, 0.3, 0.6);
    const guard = new THREE.Mesh(guardGeo, goldMaterial);
    guard.position.z = 0 + centerOffsetZ;
    guard.castShadow = true;
    guard.receiveShadow = true;
    group.add(guard);

    // 3. Handle (Grip)
    const handleGeo = new THREE.CylinderGeometry(0.35, 0.4, 3.0, 12);
    const handle = new THREE.Mesh(handleGeo, leatherMaterial);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -1.8 + centerOffsetZ;
    handle.castShadow = true;
    handle.receiveShadow = true;
    group.add(handle);

    // 4. Pommel
    const pommelGeo = new THREE.SphereGeometry(0.6, 16, 16);
    const pommel = new THREE.Mesh(pommelGeo, goldMaterial);
    pommel.position.z = -3.6 + centerOffsetZ;
    pommel.scale.set(1.0, 0.8, 1.2); // Flattened sphere
    pommel.castShadow = true;
    pommel.receiveShadow = true;
    group.add(pommel);

    // Position the whole sword on the table
    // Table surface is around y = -2.75 roughly. We want it lying flat.
    // The visual table top is y=-2.75 roughly (from other props).
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics (Static Box)
    // Create a simple box hull for collision
    if (physicsWorld && getAmmo()) {
        const Ammo = getAmmo();

        // Size: Roughly 16 units long, 4.0 wide (x), 0.6 high (y)
        // Half extents
        if (Ammo && physicsWorld) {
            const shape = new Ammo.btBoxShape(new Ammo.btVector3(2.0, 0.3, 8.0));
    
            createStaticBody(physicsWorld, group, shape);
        }
    }

    return group;
}
