import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createWaterskin(scene, physicsWorld, position = { x: 5, y: -2.75, z: 5 }, rotation = Math.PI / 4) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Waterskin';

    // Materials
    const leatherMat = new THREE.MeshStandardMaterial({
        color: 0x5c3a21, // Dark brown leather
        roughness: 0.85,
        metalness: 0.0,
        bumpScale: 0.02
    });

    const spoutMat = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b, // Wood/Cork color
        roughness: 0.9,
        metalness: 0.0
    });

    const strapMat = new THREE.MeshStandardMaterial({
        color: 0x3d2314, // Darker leather strap
        roughness: 0.9,
        metalness: 0.0
    });

    // 1. Main Body (Flattened Sphere/Capsule)
    const bodyGeo = new THREE.SphereGeometry(1.2, 32, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, leatherMat);
    // Flatten it to look like a full but squashed waterskin
    bodyMesh.scale.set(1, 0.4, 1.3);
    bodyMesh.position.set(0, 0, 0);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // 2. Neck/Spout
    const neckGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 16);
    const neckMesh = new THREE.Mesh(neckGeo, leatherMat);
    neckMesh.position.set(0, 0.1, 1.4);
    neckMesh.rotation.x = Math.PI / 2;
    neckMesh.castShadow = true;
    neckMesh.receiveShadow = true;
    group.add(neckMesh);

    // 3. Cork/Cap
    const capGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 16);
    const capMesh = new THREE.Mesh(capGeo, spoutMat);
    capMesh.position.set(0, 0.1, 1.7);
    capMesh.rotation.x = Math.PI / 2;
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    group.add(capMesh);

    // 4. Strap/Binding around neck
    const strapGeo = new THREE.TorusGeometry(0.25, 0.05, 8, 16);
    const strapMesh = new THREE.Mesh(strapGeo, strapMat);
    strapMesh.position.set(0, 0.1, 1.25);
    strapMesh.castShadow = true;
    strapMesh.receiveShadow = true;
    group.add(strapMesh);

    // Position & Rotation of Group
    group.position.set(position.x, position.y + 0.48, position.z); // Offset Y by 0.48 so it rests on table
    group.rotation.y = rotation;

    scene.add(group);

    // --- Physics Definitions ---
    let body = null;
    if (physicsWorld && ammo) {
        // We use a simple box collider for the waterskin
        const sx = 2.4;
        const sy = 0.96;
        const sz = 3.6;

        const shape = new ammo.btBoxShape(new ammo.btVector3(sx * 0.5, sy * 0.5, sz * 0.5));
        body = createStaticBody(physicsWorld, group, shape);
    }

    return {
        group,
        physicsBody: body
    };
}
