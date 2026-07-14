import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createScrollCase(scene, physicsWorld, position = { x: 0, y: -2.6, z: 0 }, rotation = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'ScrollCase';

    // Materials
    const leatherMat = new THREE.MeshStandardMaterial({
        color: 0x3d2314, // Dark brown leather
        roughness: 0.8,
        metalness: 0.1
    });

    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Tarnished brass
        roughness: 0.4,
        metalness: 0.7
    });

    // Main Tube (Leather)
    const tubeRadius = 0.3;
    const tubeLength = 2.0;
    const tubeGeo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, tubeLength, 16);
    const tube = new THREE.Mesh(tubeGeo, leatherMat);
    tube.castShadow = true;
    tube.receiveShadow = true;
    group.add(tube);

    // End Caps (Brass)
    const capRadius = tubeRadius + 0.02;
    const capLength = 0.2;
    const capGeo = new THREE.CylinderGeometry(capRadius, capRadius, capLength, 16);

    const capTop = new THREE.Mesh(capGeo, brassMat);
    capTop.position.y = tubeLength / 2;
    capTop.castShadow = true;
    capTop.receiveShadow = true;
    group.add(capTop);

    const capBottom = new THREE.Mesh(capGeo, brassMat);
    capBottom.position.y = -tubeLength / 2;
    capBottom.castShadow = true;
    capBottom.receiveShadow = true;
    group.add(capBottom);

    // Decorative Rings (Brass)
    const ringGeo = new THREE.TorusGeometry(tubeRadius + 0.01, 0.03, 8, 16);
    const ring1 = new THREE.Mesh(ringGeo, brassMat);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = tubeLength / 4;
    group.add(ring1);

    const ring2 = new THREE.Mesh(ringGeo, brassMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = -tubeLength / 4;
    group.add(ring2);

    // Position and Rotate the entire group to lie flat
    group.position.set(position.x, position.y, position.z);

    // Default rotation is lying flat along X axis
    // Apply user rotation around Y axis
    const euler = new THREE.Euler(0, 0, Math.PI / 2, 'ZYX');
    euler.y = rotation;
    group.setRotationFromEuler(euler);

    scene.add(group);

    // Physics
    // btCylinderShape expects half-extents. For a cylinder along Y axis (before our rotation),
    // half-extents are (radius, half_height, radius).
    // Our cylinder is along X axis after rotation. But wait, createStaticBody applies group's transform!
    // So the shape should match the local geometry (cylinder along Y).
    if (ammo && physicsWorld) {
        const halfExtents = new ammo.btVector3(capRadius, tubeLength / 2 + capLength / 2, capRadius);
        if (ammo && physicsWorld) {
            const shape = new ammo.btCylinderShape(halfExtents);
        
            createStaticBody(physicsWorld, group, shape);
        }
    }

    return {
        group
    };
}
