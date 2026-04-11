import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createGoblet(scene, physicsWorld, position = { x: 5, y: -2.75, z: 12 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'Goblet';

    // Goblet material: Silver/Pewter
    const silverMat = new THREE.MeshStandardMaterial({
        color: 0xc0c0c0,
        metalness: 0.9,
        roughness: 0.2,
        envMapIntensity: 1.0
    });

    // Outer and Inner Lathe Profile
    const points = [];
    // Base
    points.push(new THREE.Vector2(0, 0));
    points.push(new THREE.Vector2(0.8, 0.1));
    points.push(new THREE.Vector2(0.8, 0.2));
    points.push(new THREE.Vector2(0.2, 0.4));
    // Stem
    points.push(new THREE.Vector2(0.15, 0.8));
    points.push(new THREE.Vector2(0.2, 1.2));
    points.push(new THREE.Vector2(0.15, 1.6));
    // Cup Base
    points.push(new THREE.Vector2(0.8, 1.8));
    points.push(new THREE.Vector2(1.2, 2.4));
    points.push(new THREE.Vector2(1.3, 3.2));
    points.push(new THREE.Vector2(1.2, 3.8));
    points.push(new THREE.Vector2(1.25, 4.0)); // Rim

    // Inner Cup profile (to make it hollow)
    points.push(new THREE.Vector2(1.15, 4.0)); // Inner Rim
    points.push(new THREE.Vector2(1.1, 3.2));
    points.push(new THREE.Vector2(0.7, 2.2));
    points.push(new THREE.Vector2(0.0, 2.0));

    const latheGeo = new THREE.LatheGeometry(points, 32);
    const gobletMesh = new THREE.Mesh(latheGeo, silverMat);

    // Scale down a bit to fit on the table nicely
    gobletMesh.scale.set(0.6, 0.6, 0.6);
    gobletMesh.castShadow = true;
    gobletMesh.receiveShadow = true;

    group.add(gobletMesh);

    // Decorative ring on stem
    const ringGeo = new THREE.TorusGeometry(0.2, 0.05, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({
        color: 0xffd700, // Gold trim
        metalness: 1.0,
        roughness: 0.3
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 1.0;
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(0.6, 0.6, 0.6);
    ring.castShadow = true;
    group.add(ring);

    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    scene.add(group);

    // Physics
    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // Use a cylinder shape for the goblet
        const radius = 1.3 * 0.6; // Max radius * scale
        const height = 4.0 * 0.6; // Max height * scale

        // Physics shape is centered, so we need to offset the position
        const shape = new Ammo.btCylinderShape(new Ammo.btVector3(radius, height / 2, radius));

        const proxy = new THREE.Object3D();
        proxy.position.copy(group.position);
        proxy.position.y += height / 2; // Move up by half height since group origin is at bottom
        proxy.quaternion.copy(group.quaternion);

        createStaticBody(physicsWorld, proxy, shape);
    }

    return { group };
}
