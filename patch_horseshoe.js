const fs = require('fs');

const code = `import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createHorseshoe(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotation = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Horseshoe';

    // Rusted iron material
    const material = new THREE.MeshStandardMaterial({
        color: 0x2c2522, // Dark rusty brown/grey
        roughness: 0.85,
        metalness: 0.6,
    });

    // U-shape using a partial torus
    const radius = 0.8;
    const tube = 0.15;
    const radialSegments = 8;
    const tubularSegments = 24;
    const arc = Math.PI * 1.4; // Slightly more than half a circle for a horseshoe shape

    const geometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments, arc);
    const mesh = new THREE.Mesh(geometry, material);

    // Rotate so it lays flat
    mesh.rotation.x = Math.PI / 2;
    // Rotate to orient opening
    mesh.rotation.z = Math.PI / 2;

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    group.add(mesh);

    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotation;

    // Physics
    // Using a single box collider that encompasses the horseshoe bounds.
    // Torus radius=0.8, tube=0.15. Total width ~ 0.95 + 0.15 = 1.1
    // Box dimensions: x, y, z. We need half-extents for btBoxShape.
    if (ammo && physicsWorld) {
        const halfExtents = new ammo.btVector3(1.0, 0.15, 1.0);
        const shape = new ammo.btBoxShape(halfExtents);

        // createStaticBody expects a mesh/object with position and quaternion
        const dummy = new THREE.Object3D();
        dummy.position.copy(group.position);
        dummy.quaternion.copy(group.quaternion);

        createStaticBody(physicsWorld, dummy, shape);

        // Clean up Ammo memory for vector
        ammo.destroy(halfExtents);
    }

    scene.add(group);

    return { group };
}
`;

fs.writeFileSync('src/environment/Horseshoe.js', code);
