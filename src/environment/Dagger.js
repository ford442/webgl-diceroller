import * as THREE from 'three';
import { getAmmo } from '../physics.js';

export function createDagger(scene, physicsWorld) {
    const group = new THREE.Group();

    // Materials
    const steelMaterial = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.9,
        roughness: 0.2
    });

    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.8,
        roughness: 0.3
    });

    const leatherMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a3c31,
        roughness: 0.9
    });

    // 1. Blade
    // Long, thin, sharp
    const bladeGeo = new THREE.BoxGeometry(0.8, 0.1, 5.0);
    // Taper the tip (simple way: just scale/position, but box is fine for low poly style)
    // Actually, let's make it a bit more shaped by using a flattened cylinder or just a box.
    // Box is safer for simple props.
    const blade = new THREE.Mesh(bladeGeo, steelMaterial);
    blade.position.z = 2.5; // Extends forward
    blade.castShadow = true;
    blade.receiveShadow = true;
    group.add(blade);

    // 2. Crossguard
    const guardGeo = new THREE.BoxGeometry(2.5, 0.2, 0.4);
    const guard = new THREE.Mesh(guardGeo, goldMaterial);
    guard.position.z = 0;
    guard.castShadow = true;
    guard.receiveShadow = true;
    group.add(guard);

    // 3. Handle
    const handleGeo = new THREE.CylinderGeometry(0.3, 0.3, 2.0, 8);
    const handle = new THREE.Mesh(handleGeo, leatherMaterial);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -1.2;
    handle.castShadow = true;
    handle.receiveShadow = true;
    group.add(handle);

    // 4. Pommel
    const pommelGeo = new THREE.SphereGeometry(0.4, 16, 16);
    const pommel = new THREE.Mesh(pommelGeo, goldMaterial);
    pommel.position.z = -2.4;
    pommel.castShadow = true;
    pommel.receiveShadow = true;
    group.add(pommel);

    // Position the whole dagger on the table
    // Table is at y = -3 roughly.
    // We want it lying flat.
    group.position.set(5, -2.45, -2);
    group.rotation.y = Math.PI / 4; // Angled casually

    scene.add(group);

    // Physics (Static Box)
    // Create a simple box hull for collision
    if (physicsWorld) {
        const Ammo = getAmmo();
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(group.position.x, group.position.y, group.position.z));

        // Rotation (Quaternion)
        const quat = group.quaternion;
        transform.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));

        // Size: Roughly 8 units long (z), 2.5 wide (x), 0.5 high (y)
        // Half extents
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(1.25, 0.2, 4.0));

        const mass = 0; // Static
        const localInertia = new Ammo.btVector3(0, 0, 0);
        const motionState = new Ammo.btDefaultMotionState(transform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        const body = new Ammo.btRigidBody(rbInfo);

        body.setFriction(0.5);
        body.setRestitution(0.1);

        physicsWorld.addRigidBody(body);
    }

    return group;
}
