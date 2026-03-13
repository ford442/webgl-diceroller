import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createWaxSeal(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'WaxSealStamp';

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x3e2723, // Dark stained wood
        roughness: 0.7,
        metalness: 0.1
    });

    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass
        metalness: 0.9,
        roughness: 0.3
    });

    const waxMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000, // Dark red wax
        roughness: 0.4,
        metalness: 0.1
    });

    // 1. Stamp Handle (Wood)
    // We'll use a LatheGeometry for a nice turned wood handle.
    const points = [];
    points.push(new THREE.Vector2(0, 0));
    points.push(new THREE.Vector2(0.15, 0));
    points.push(new THREE.Vector2(0.2, 0.1));
    points.push(new THREE.Vector2(0.12, 0.3));
    points.push(new THREE.Vector2(0.1, 0.5));
    points.push(new THREE.Vector2(0.15, 0.8));
    points.push(new THREE.Vector2(0.25, 0.9));
    points.push(new THREE.Vector2(0.2, 1.0));
    points.push(new THREE.Vector2(0, 1.0)); // Top center

    const handleGeo = new THREE.LatheGeometry(points, 16);
    const handleMesh = new THREE.Mesh(handleGeo, woodMat);
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;

    // Position handle slightly up so the base can attach at y=0
    handleMesh.position.y = 0.2;
    group.add(handleMesh);

    // 2. Brass Base (The metal stamp part)
    const baseHeight = 0.2;
    const baseRadius = 0.3;
    const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 16);
    const baseMesh = new THREE.Mesh(baseGeo, brassMat);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    baseMesh.position.y = baseHeight / 2; // Bottom at 0
    group.add(baseMesh);

    // 3. Wax Puddle (Next to the stamp)
    // Puddle is flat, slightly irregular.
    const waxRadius = 0.4;
    const waxHeight = 0.05;
    const waxGeo = new THREE.CylinderGeometry(waxRadius, waxRadius, waxHeight, 16);

    // Add some noise to the vertices to make it look melted and irregular
    const positions = waxGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        // Only modify outer vertices (X/Z plane), keep center (x=0, z=0) flat
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const y = positions.getY(i);

        // If not top/bottom center vertices
        if (Math.abs(x) > 0.01 || Math.abs(z) > 0.01) {
            // Apply a simple wavy offset
            const offset = (Math.sin(x * 10) + Math.cos(z * 10)) * 0.05;

            // Push outwards mostly, but also slightly up/down
            const len = Math.sqrt(x*x + z*z);
            if (len > 0) {
                positions.setX(i, x + (x/len) * offset);
                positions.setZ(i, z + (z/len) * offset);
            }
            if (y > 0) { // Top surface
                positions.setY(i, y + (Math.random() * 0.02));
            }
        }
    }
    waxGeo.computeVertexNormals();

    const waxMesh = new THREE.Mesh(waxGeo, waxMat);
    waxMesh.castShadow = true;
    waxMesh.receiveShadow = true;

    // Position puddle on the table next to the stamp
    waxMesh.position.set(0.6, waxHeight / 2, 0.2);
    group.add(waxMesh);

    // Add a tiny wax drip on the side of the brass base
    const dripGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const dripMesh = new THREE.Mesh(dripGeo, waxMat);
    dripMesh.position.set(baseRadius - 0.01, baseHeight / 2, 0);
    dripMesh.scale.y = 2.0; // Stretch downwards
    group.add(dripMesh);

    // --- Position on Table ---
    // Table Top is at Y = -2.75.
    // The group bottom (baseMesh bottom) is at Y = 0 local.
    const stampPosX = 3.5;
    const stampPosZ = -4.5;
    const stampPosY = -2.75;

    group.position.set(stampPosX, stampPosY, stampPosZ);

    // Randomize rotation slightly around Y to make it look naturally placed
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // --- Physics ---
    // The main collision shape should be a cylinder for the stamp.
    // Total height = baseHeight (0.2) + handle height (approx 1.0) = 1.2
    const totalHeight = 1.2;
    // We'll use a physics cylinder encompassing the handle and base.
    // Max radius is baseRadius (0.3).
    // Note: Ammo.btCylinderShape expects half-extents.
    const shape = new ammo.btCylinderShape(new ammo.btVector3(baseRadius, totalHeight / 2, baseRadius));

    // Since createStaticBody sets the collision shape center at the group's origin,
    // and our group's origin is at the bottom (y=0) while the shape is centered,
    // we need to offset the shape center.
    // It's easier to move the group's logical center and visually offset the children down.

    // Move group center up by totalHeight/2:
    group.position.y += totalHeight / 2;

    // Move all children down by totalHeight/2 to keep them visually at Y=-2.75:
    handleMesh.position.y -= totalHeight / 2;
    baseMesh.position.y -= totalHeight / 2;
    waxMesh.position.y -= totalHeight / 2;
    dripMesh.position.y -= totalHeight / 2;

    createStaticBody(physicsWorld, group, shape);

    // Puddle is flat enough not to need its own physics body unless dice really need to bump it.
    // Given height is 0.05, dice will likely just roll over it smoothly or we can ignore it to save physics.
}
