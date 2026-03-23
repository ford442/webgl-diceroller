import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { registerInteractiveObject } from '../interaction.js';

export function createWand(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'MagicWand';

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x2d1a11,
        roughness: 0.8,
        metalness: 0.1
    });

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.3,
        metalness: 0.8,
        envMapIntensity: 1.0
    });

    const crystalMat = new THREE.MeshPhysicalMaterial({
        color: 0x00ffff,
        emissive: 0x0088ff,
        emissiveIntensity: 0.5,
        roughness: 0.1,
        transmission: 0.9,
        transparent: true
    });

    const yOffset = -0.35; // Center the meshes around the local Y origin for physics alignment

    // Shaft
    const shaftLen = 1.0;
    const shaftRadiusBottom = 0.04;
    const shaftRadiusTop = 0.02;
    const shaftGeo = new THREE.CylinderGeometry(shaftRadiusTop, shaftRadiusBottom, shaftLen, 16);
    const shaftMesh = new THREE.Mesh(shaftGeo, woodMat);
    shaftMesh.position.y = (shaftLen / 2) + yOffset;
    shaftMesh.castShadow = true;
    shaftMesh.receiveShadow = true;
    group.add(shaftMesh);

    // Handle
    const handleLen = 0.4;
    const handleGeo = new THREE.CylinderGeometry(0.05, 0.05, handleLen, 16);
    const handleMesh = new THREE.Mesh(handleGeo, woodMat);
    handleMesh.position.y = (-handleLen / 2) + yOffset;
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;
    group.add(handleMesh);

    // Gold rings
    const ringGeo = new THREE.TorusGeometry(0.055, 0.01, 8, 16);

    const ring1 = new THREE.Mesh(ringGeo, goldMat);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = 0 + yOffset;
    group.add(ring1);

    const ring2 = new THREE.Mesh(ringGeo, goldMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = -handleLen + yOffset;
    group.add(ring2);

    // Crystal Tip
    const crystalGeo = new THREE.OctahedronGeometry(0.06, 0);
    const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
    crystalMesh.position.y = shaftLen + 0.03 + yOffset;
    crystalMesh.scale.y = 2.0; // Elongate the crystal
    group.add(crystalMesh);

    // Point light for the glowing tip
    const glowLight = new THREE.PointLight(0x00ffff, 0.5, 2.0);
    glowLight.position.y = shaftLen + 0.03 + yOffset;
    group.add(glowLight);

    // Interactive Toggle Glow
    let isGlowing = true;
    const toggleGlow = () => {
        isGlowing = !isGlowing;
        crystalMat.emissiveIntensity = isGlowing ? 2.5 : 0.2;
        glowLight.intensity = isGlowing ? 2.0 : 0.0;
    };

    // Register the crystal as interactive
    registerInteractiveObject(crystalMesh, toggleGlow);

    // Positioning and Rotation
    const totalLen = shaftLen + handleLen + 0.1; // roughly 1.5 units

    // Position on table top (Y = -2.75)
    // The cylinder radius is ~0.05. Center Y = -2.75 + 0.05 = -2.70
    group.position.set(3, -2.70, 1);

    // Rotate to lay flat. 'YXZ' rotation order to prevent gimbal lock.
    group.rotation.set(0, Math.PI / 4, Math.PI / 2, 'YXZ');

    scene.add(group);

    // Physics
    // CylinderShape is Y-axis aligned by default. The group rotation will orient it horizontally.
    const shape = new ammo.btCylinderShape(new ammo.btVector3(0.05, totalLen / 2, 0.05));

    // We adjust the physics body to perfectly overlap the visual meshes by centering the body.
    // The visual center of mass is around Y=0 in the group's local space.
    createStaticBody(physicsWorld, group, shape);

    return { group, toggleGlow };
}
