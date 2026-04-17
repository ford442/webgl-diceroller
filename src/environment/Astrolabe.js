import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createAstrolabe(scene, physicsWorld, position, rotationY) {
    const group = new THREE.Group();
    group.name = 'Astrolabe';

    // Materials
    const brassMaterial = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass color
        roughness: 0.3,
        metalness: 0.8,
    });

    const darkBrassMaterial = new THREE.MeshStandardMaterial({
        color: 0x8a7b32,
        roughness: 0.4,
        metalness: 0.8,
    });

    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a, // Iron base
        roughness: 0.7,
        metalness: 0.9,
    });

    // Dimensions
    const baseRadius = 0.5;
    const baseHeight = 0.1;
    const supportHeight = 1.0;
    const ringRadius = 0.8;
    const ringTube = 0.04;

    // 1. Base
    const baseGeometry = new THREE.CylinderGeometry(baseRadius, baseRadius * 1.2, baseHeight, 16);
    const base = new THREE.Mesh(baseGeometry, ironMaterial);
    base.position.y = baseHeight / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // 2. Central Support/Axis
    const supportGeometry = new THREE.CylinderGeometry(0.05, 0.05, supportHeight, 8);
    const support = new THREE.Mesh(supportGeometry, darkBrassMaterial);
    support.position.y = baseHeight + supportHeight / 2;
    support.castShadow = true;
    support.receiveShadow = true;
    group.add(support);

    // 3. Rings
    const ringCenterY = baseHeight + supportHeight / 2;

    // Outer Ring (fixed)
    const outerRingGeometry = new THREE.TorusGeometry(ringRadius, ringTube, 8, 32);
    const outerRing = new THREE.Mesh(outerRingGeometry, brassMaterial);
    outerRing.position.y = ringCenterY;
    // Rotate to stand upright
    outerRing.rotation.y = Math.PI / 4;
    outerRing.castShadow = true;
    outerRing.receiveShadow = true;
    group.add(outerRing);

    // Inner Ring 1
    const innerRing1Geometry = new THREE.TorusGeometry(ringRadius * 0.85, ringTube * 0.9, 8, 32);
    const innerRing1 = new THREE.Mesh(innerRing1Geometry, darkBrassMaterial);
    innerRing1.position.y = ringCenterY;
    innerRing1.rotation.x = Math.PI / 3;
    innerRing1.rotation.y = Math.PI / 6;
    innerRing1.castShadow = true;
    innerRing1.receiveShadow = true;
    group.add(innerRing1);

    // Inner Ring 2
    const innerRing2Geometry = new THREE.TorusGeometry(ringRadius * 0.7, ringTube * 0.8, 8, 32);
    const innerRing2 = new THREE.Mesh(innerRing2Geometry, brassMaterial);
    innerRing2.position.y = ringCenterY;
    innerRing2.rotation.x = -Math.PI / 4;
    innerRing2.rotation.z = Math.PI / 6;
    innerRing2.castShadow = true;
    innerRing2.receiveShadow = true;
    group.add(innerRing2);

    // 4. Central Sphere/Sun
    const sphereGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    const sphere = new THREE.Mesh(sphereGeometry, brassMaterial);
    sphere.position.y = ringCenterY;
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    group.add(sphere);

    // Position and Rotation of the entire group
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    scene.add(group);

    // --- Physics ---
    let body = null;
    if (physicsWorld) {
        const Ammo = getAmmo();

        // Use a cylinder shape that encompasses the rings
        // Height covers base to top of rings
        const totalHeight = baseHeight + supportHeight + ringRadius;
        const collisionRadius = ringRadius * 1.1; // Slightly larger for padding

        const shape = new Ammo.btCylinderShape(new Ammo.btVector3(collisionRadius, totalHeight / 2, collisionRadius));

        // Create an invisible proxy mesh to align the physics body
        const proxyMesh = new THREE.Mesh();
        proxyMesh.position.copy(group.position);
        proxyMesh.position.y += totalHeight / 2; // Move origin to center of cylinder
        proxyMesh.quaternion.copy(group.quaternion);

        body = createStaticBody(physicsWorld, proxyMesh, shape);
    }

    return {
        group,
        physicsBody: body,
        update: (deltaTime, elapsedTime) => {
            // Optional: Make inner rings slowly rotate for a magical effect
            innerRing1.rotation.y += deltaTime * 0.2;
            innerRing2.rotation.z += deltaTime * 0.3;
            innerRing1.rotation.x += deltaTime * 0.1;
        }
    };
}
