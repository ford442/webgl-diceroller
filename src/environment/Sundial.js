import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createSundial(scene, physicsWorld, position = { x: 5, y: -2.75, z: 6 }, rotationY = -Math.PI / 6) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Sundial';

    // Materials
    // Worn Brass
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass
        roughness: 0.4,
        metalness: 0.8,
        bumpScale: 0.02
    });

    const darkBrassMat = new THREE.MeshStandardMaterial({
        color: 0x8a7b32, // Darker brass for contrast
        roughness: 0.5,
        metalness: 0.7
    });

    // 1. Base Plate (Cylinder)
    const baseRadius = 1.2;
    const baseHeight = 0.2;
    const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 32);
    const baseMesh = new THREE.Mesh(baseGeo, brassMat);
    baseMesh.position.set(0, baseHeight / 2, 0);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Inner Dial Ring (Slightly raised)
    const ringGeo = new THREE.TorusGeometry(baseRadius - 0.2, 0.05, 16, 32);
    const ringMesh = new THREE.Mesh(ringGeo, darkBrassMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(0, baseHeight + 0.02, 0);
    ringMesh.castShadow = true;
    ringMesh.receiveShadow = true;
    group.add(ringMesh);

    // 3. The Gnomon (The triangular part that casts the shadow)
    // We can make a triangle using a custom shape or simply use a rotated box/cylinder
    // Let's use a wedge shape via ExtrudeGeometry
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(baseRadius - 0.3, 0);
    shape.lineTo(0, baseRadius - 0.3); // Triangle pointing up
    shape.lineTo(0, 0);

    const extrudeSettings = { depth: 0.05, bevelEnabled: false };
    const gnomonGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // Center the geometry
    gnomonGeo.computeBoundingBox();
    const centerOffset = -0.5 * (gnomonGeo.boundingBox.max.z - gnomonGeo.boundingBox.min.z);
    gnomonGeo.translate(0, 0, centerOffset);

    const gnomonMesh = new THREE.Mesh(gnomonGeo, darkBrassMat);
    gnomonMesh.position.set(-0.2, baseHeight, 0); // Position on base
    gnomonMesh.castShadow = true;
    gnomonMesh.receiveShadow = true;
    group.add(gnomonMesh);

    // --- Position on Table ---
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics ---
    if (ammo) {
        // Use a simple cylinder shape for the base
        if (ammo && physicsWorld) {
            const shape = new ammo.btCylinderShape(new ammo.btVector3(baseRadius, baseHeight / 2, baseRadius));
            // Let's fix that directly by adjusting visuals:
            group.position.set(position.x, position.y + baseHeight / 2, position.z);
    
            // Now adjust local visual positions down by baseHeight / 2
            baseMesh.position.set(0, 0, 0);
            ringMesh.position.set(0, baseHeight / 2 + 0.02, 0);
            gnomonMesh.position.set(-0.2, baseHeight / 2, 0);
    
            createStaticBody(physicsWorld, group, shape);
        }
    }

    return { group };
}
