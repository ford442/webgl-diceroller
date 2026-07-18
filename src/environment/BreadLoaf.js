import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createBreadLoaf(scene, physicsWorld, position = { x: 8, y: -2.75, z: 4 }, rotationY = Math.PI / 6) {
    const group = new THREE.Group();
    group.name = 'BreadLoaf';

    const width = 1.2;
    const height = 0.8;
    const depth = 2.0;

    // Crusty bread material
    const crustMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b, // Crusty brown
        roughness: 0.9,
        metalness: 0.0,
        bumpScale: 0.05
    });

    const geometry = new THREE.SphereGeometry(1, 32, 16);
    const mesh = new THREE.Mesh(geometry, crustMaterial);

    // Scale sphere into an oblong loaf shape
    mesh.scale.set(width / 2, height / 2, depth / 2);

    // Add half height to Y so it rests on the table surface (Y = -2.75)
    mesh.position.set(0, height / 2, 0);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    group.add(mesh);

    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // Use a static btBoxShape for the physics collider
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(width / 2, height / 2, depth / 2));

        // Physics center needs to match the mesh center which is offset by height / 2
        const dummy = new THREE.Object3D();
        dummy.position.copy(group.position);
        dummy.position.y += height / 2;
        dummy.quaternion.copy(group.quaternion);

        createStaticBody(physicsWorld, dummy, shape);

        // Expose for interactions if needed, though mostly visual
        group.userData.physicsBody = dummy.userData.physicsBody;
    }

    return { group };
}
