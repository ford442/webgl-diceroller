import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createWoodenSpoon(scene, physicsWorld, position = { x: -6, y: -2.75, z: 6 }, rotationY = Math.PI / 4) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'WoodenSpoon';

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b, // Brown wood color
        roughness: 0.8,
        metalness: 0.0
    });

    // 1. Spoon Handle
    const handleLen = 1.2;
    const handleRadius = 0.05;
    const handleGeo = new THREE.CylinderGeometry(handleRadius, handleRadius, handleLen, 16);
    const handleMesh = new THREE.Mesh(handleGeo, woodMat);
    handleMesh.rotation.x = Math.PI / 2;
    handleMesh.position.z = handleLen / 2;
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;
    group.add(handleMesh);

    // 2. Spoon Bowl
    const bowlRadius = 0.2;
    const bowlGeo = new THREE.SphereGeometry(bowlRadius, 16, 16);
    // Flatten the bowl to make it spoon-shaped
    bowlGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.3, 1.2));
    const bowlMesh = new THREE.Mesh(bowlGeo, woodMat);
    bowlMesh.position.z = -0.1; // Place at the end of the handle
    bowlMesh.castShadow = true;
    bowlMesh.receiveShadow = true;
    group.add(bowlMesh);

    // Position and rotation on table
    group.position.set(position.x, position.y + 0.06, position.z); // Slightly above floorY to avoid clipping
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics (Use a single box shape that covers the handle and bowl)
    const totalLen = handleLen + bowlRadius * 2.4;
    const boxShape = new ammo.btBoxShape(new ammo.btVector3(bowlRadius, 0.1, totalLen / 2));

    // Offset for the compound body isn't needed if we make a simple approximation box centered on the group
    // The handle goes from Z=0 to Z=1.2, bowl is at Z=-0.1.
    // Let's create a proxy mesh for the static body to be positioned correctly
    const proxyMesh = new THREE.Mesh(new THREE.BoxGeometry(bowlRadius * 2, 0.2, totalLen));

    // The center of our spoon group is at Z=0. The handle goes to Z=1.2, bowl to Z ~ -0.3.
    // Midpoint Z is roughly (1.2 - 0.3) / 2 = 0.45.
    proxyMesh.position.copy(group.position);

    // We apply an offset to the proxy mesh so the physics box aligns with the visuals
    const localOffset = new THREE.Vector3(0, 0, 0.45);
    localOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    proxyMesh.position.add(localOffset);
    proxyMesh.rotation.y = rotationY;

    createStaticBody(physicsWorld, proxyMesh, boxShape);

    return { group };
}
