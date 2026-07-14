import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createCrown(scene, physicsWorld, position = { x: -14, y: -2.75, z: 6 }, rotationY = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'KingsCrown';

    // Dimensions
    const radiusTop = 0.9;
    const radiusBottom = 0.8;
    const height = 1.0;

    // Materials
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700, // Gold
        metalness: 1.0,
        roughness: 0.3
    });

    const velvetMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000, // Dark Red Velvet
        roughness: 0.9,
        metalness: 0.1
    });

    const rubyMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000,
        metalness: 0.2,
        roughness: 0.1,
        transmission: 0.8,
        ior: 1.76,
        clearcoat: 1.0,
        transparent: true
    });

    const sapphireMat = new THREE.MeshPhysicalMaterial({
        color: 0x0f52ba,
        metalness: 0.2,
        roughness: 0.1,
        transmission: 0.8,
        ior: 1.76,
        clearcoat: 1.0,
        transparent: true
    });

    // 1. Base Ring (Cylinder with open ends, or just a Torus/Cylinder)
    const baseGeo = new THREE.CylinderGeometry(radiusBottom + 0.05, radiusBottom, 0.3, 32);
    const baseMesh = new THREE.Mesh(baseGeo, goldMat);
    baseMesh.position.y = 0.15; // Bottom at 0
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Velvet Inner Cap (Dome)
    const domeGeo = new THREE.SphereGeometry(radiusBottom - 0.05, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMesh = new THREE.Mesh(domeGeo, velvetMat);
    domeMesh.position.y = 0.2; // Sit inside base
    // Scale slightly on Y to make it less spherical
    domeMesh.scale.y = 1.2;
    domeMesh.castShadow = true;
    domeMesh.receiveShadow = true;
    group.add(domeMesh);

    // 3. Spikes/Arches
    const numSpikes = 8;
    for (let i = 0; i < numSpikes; i++) {
        const angle = (i / numSpikes) * Math.PI * 2;

        // Spike Geometry
        // We can use a cone
        const spikeGeo = new THREE.ConeGeometry(0.15, height - 0.2, 16);
        const spikeMesh = new THREE.Mesh(spikeGeo, goldMat);

        // Position on the rim
        const px = Math.cos(angle) * radiusBottom;
        const pz = Math.sin(angle) * radiusBottom;

        spikeMesh.position.set(px, 0.3 + (height - 0.2) / 2, pz);

        // Tilt slightly outwards
        spikeMesh.lookAt(new THREE.Vector3(0, spikeMesh.position.y, 0));
        spikeMesh.rotation.x += -Math.PI / 2;
        // Adjust angle to face outwards
        spikeMesh.rotation.x = -0.2;

        // Re-calculate lookAt and tilt manually for better control
        spikeMesh.position.set(px, 0.3 + (height - 0.2) / 2, pz);

        // We want the tip pointing UP and slightly OUT.
        // Default Cone points UP (+Y).
        // Rotate around Z or X depending on angle.
        spikeMesh.rotation.set(0, -angle + Math.PI/2, 0.2, 'YXZ');

        spikeMesh.castShadow = true;
        group.add(spikeMesh);

        // Add a gem to the tip of each spike
        const isRuby = i % 2 === 0;
        const gemGeo = new THREE.SphereGeometry(0.08, 16, 16);
        const gemMesh = new THREE.Mesh(gemGeo, isRuby ? rubyMat : sapphireMat);
        gemMesh.position.y = (height - 0.2) / 2 + 0.05;
        spikeMesh.add(gemMesh);

        // Add gem to base
        const baseGemGeo = new THREE.BoxGeometry(0.15, 0.15, 0.05);
        const baseGemMesh = new THREE.Mesh(baseGemGeo, isRuby ? sapphireMat : rubyMat);

        // Rotate and position on base
        baseGemMesh.position.set(
            Math.cos(angle) * (radiusBottom + 0.06),
            0.15,
            Math.sin(angle) * (radiusBottom + 0.06)
        );
        baseGemMesh.rotation.y = -angle + Math.PI/2;
        group.add(baseGemMesh);
    }

    // Top cross/ornament on the velvet
    const crossGeo = new THREE.TorusGeometry(0.1, 0.03, 16, 32);
    const crossMesh = new THREE.Mesh(crossGeo, goldMat);
    crossMesh.position.y = 0.2 + (radiusBottom - 0.05) * 1.2 + 0.1;
    crossMesh.rotation.x = Math.PI / 2;
    group.add(crossMesh);

    const crossTop = new THREE.Mesh(new THREE.SphereGeometry(0.05), rubyMat);
    crossTop.position.y = crossMesh.position.y;
    group.add(crossTop);

    // --- Position on Table ---
    // Table Top -2.75.
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics ---
    // Cylinder shape covering the whole crown
    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radiusTop, height / 2, radiusTop));
    
        // The visual group's Y origin is at the bottom (y=0).
        // The physics shape origin should be at y = height / 2.
        // Shift visual meshes down relative to group, and move group up.
        group.position.y = position.y + height / 2;
    
        // Offset all children down by height/2
        const childrenToMove = [...group.children];
        childrenToMove.forEach(child => {
            child.position.y -= height / 2;
        });
    
        createStaticBody(physicsWorld, group, shape);
    }

    return {
        group
    };
}
