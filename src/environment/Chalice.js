import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createChalice(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Chalice';

    // Materials
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffaa00, // Gold
        metalness: 1.0,
        roughness: 0.2
    });

    const rubyMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000,
        emissive: 0x330000,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.9,
        ior: 1.76,
        thickness: 0.5,
        transparent: true
    });

    // Base
    const baseGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.1, 16);
    const baseMesh = new THREE.Mesh(baseGeo, goldMat);
    baseMesh.position.y = 0.05;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // Stem
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8);
    const stemMesh = new THREE.Mesh(stemGeo, goldMat);
    stemMesh.position.y = 0.35;
    stemMesh.castShadow = true;
    stemMesh.receiveShadow = true;
    group.add(stemMesh);

    // Node (Decorative bump on stem)
    const nodeGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const nodeMesh = new THREE.Mesh(nodeGeo, goldMat);
    nodeMesh.position.y = 0.35;
    nodeMesh.castShadow = true;
    nodeMesh.receiveShadow = true;
    group.add(nodeMesh);

    // Cup
    // Use Lathe for a nice goblet shape
    const points = [];
    // From bottom of cup to top lip
    points.push(new THREE.Vector2(0, 0));       // Center bottom
    points.push(new THREE.Vector2(0.3, 0.1));     // Curve up and out
    points.push(new THREE.Vector2(0.4, 0.3));
    points.push(new THREE.Vector2(0.45, 0.6));
    points.push(new THREE.Vector2(0.43, 0.8));    // Slight inward near top
    points.push(new THREE.Vector2(0.44, 0.82));   // Outer lip
    points.push(new THREE.Vector2(0.40, 0.82));   // Inner lip
    points.push(new THREE.Vector2(0.38, 0.8));    // Inner inward
    points.push(new THREE.Vector2(0.40, 0.6));
    points.push(new THREE.Vector2(0.35, 0.3));
    points.push(new THREE.Vector2(0.25, 0.15));
    points.push(new THREE.Vector2(0, 0.05));      // Inner center bottom

    const cupGeo = new THREE.LatheGeometry(points, 32);
    const cupMesh = new THREE.Mesh(cupGeo, goldMat);
    cupMesh.position.y = 0.6; // Sit on stem
    cupMesh.castShadow = true;
    cupMesh.receiveShadow = true;
    group.add(cupMesh);

    // Decorative Ruby Gems
    const gemGeo = new THREE.OctahedronGeometry(0.04, 0);
    const numGems = 4;
    for (let i = 0; i < numGems; i++) {
        const gem = new THREE.Mesh(gemGeo, rubyMat);
        const angle = (i / numGems) * Math.PI * 2;
        // Place on the node of the stem
        gem.position.set(
            Math.cos(angle) * 0.12,
            0.35,
            Math.sin(angle) * 0.12
        );
        gem.rotation.set(Math.random(), Math.random(), Math.random());
        gem.castShadow = true;
        group.add(gem);
    }

    // Liquid inside (Wine)
    const liquidGeo = new THREE.CylinderGeometry(0.38, 0.25, 0.4, 16);
    const liquidMat = new THREE.MeshPhysicalMaterial({
        color: 0x4a0404, // Dark Red Wine
        emissive: 0x110000,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.9,
        ior: 1.33,
        thickness: 0.5,
        transparent: true
    });
    const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
    liquidMesh.position.y = 0.95; // Inside cup
    group.add(liquidMesh);

    // Position on Table
    // Table Top -2.75.
    // Chalice base starts at 0 locally, so group.position.y = -2.75
    group.position.set(3, -2.75, 4);
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    // Approximating with a Cylinder shape for stability
    // Total height = base + stem + cup = 0.1 + 0.5 + 0.82 = 1.42
    // Center of cylinder should be at height/2
    const totalHeight = 1.42;
    const maxRadius = 0.45;

    // Create a body with an offset center so the origin is at the bottom.
    // However, createStaticBody centers the shape on the group's position (which is at the bottom).
    // So if the shape is symmetric, its center is at group.position.
    // To fix this without modifying createStaticBody:
    // We add an invisible mesh centered at totalHeight/2, and create the body on that mesh.

    const physMesh = new THREE.Mesh(new THREE.BoxGeometry(maxRadius*2, totalHeight, maxRadius*2));
    physMesh.position.copy(group.position);
    physMesh.position.y += totalHeight / 2;
    physMesh.rotation.copy(group.rotation);
    physMesh.visible = false;
    scene.add(physMesh);

    const shape = new ammo.btCylinderShape(new ammo.btVector3(maxRadius, totalHeight/2, maxRadius));
    createStaticBody(physicsWorld, physMesh, shape);
}
