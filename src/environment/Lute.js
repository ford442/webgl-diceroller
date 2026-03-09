import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createLute(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    const luteGroup = new THREE.Group();
    luteGroup.name = 'Lute';

    const ammo = getAmmo();

    // Texture Loading
    const textureLoader = new THREE.TextureLoader();
    const woodDiffuse = textureLoader.load('/images/wood_diffuse.jpg');
    const woodBump = textureLoader.load('/images/wood_bump.jpg');
    const woodRoughness = textureLoader.load('/images/wood_roughness.jpg');

    [woodDiffuse, woodBump, woodRoughness].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = (t === woodDiffuse) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    });

    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.05,
        roughnessMap: woodRoughness,
        roughness: 0.6,
        color: 0xffcc88 // Lighter wood tint for the body
    });

    const darkWoodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.05,
        roughnessMap: woodRoughness,
        roughness: 0.8,
        color: 0x3f1f1f // Dark wood for neck
    });

    const stringMaterial = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        metalness: 0.5,
        roughness: 0.2
    });

    const blackMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.9
    });

    // 1. Body (Tear-drop shape approximated)
    // We'll use a flattened sphere for the bowl and a flat cylinder for the top plate.
    const bodyGeo = new THREE.SphereGeometry(1.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2); // Half sphere
    const bodyMesh = new THREE.Mesh(bodyGeo, darkWoodMaterial);
    // Flatten the bowl slightly
    bodyMesh.scale.set(1, 1, 0.6);
    // Rotate so the flat part (top plate) is facing up (Z axis normally, let's make it face Y+)
    bodyMesh.rotation.x = Math.PI / 2;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    luteGroup.add(bodyMesh);

    // Soundboard (Top plate)
    const topGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.05, 32);
    const topMesh = new THREE.Mesh(topGeo, woodMaterial);
    // Scale to match flattened body
    topMesh.scale.set(1, 1, 0.6);
    // Position slightly above the cut of the half-sphere
    topMesh.position.y = 0.025;
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    luteGroup.add(topMesh);

    // Sound hole (Rosette)
    const holeGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.06, 32);
    const holeMesh = new THREE.Mesh(holeGeo, blackMaterial);
    // Scale hole to match the top plate's distortion if we want, or keep it perfectly round.
    // Lute soundboards often have round holes.
    // The topMesh has scale.z = 0.6. To make hole round in world space, scale z by 1/0.6? No, just don't scale it, it's a separate mesh.
    holeMesh.position.set(0, 0.03, -0.4); // Offset towards the neck
    luteGroup.add(holeMesh);

    // Bridge
    const bridgeGeo = new THREE.BoxGeometry(1.2, 0.1, 0.2);
    const bridgeMesh = new THREE.Mesh(bridgeGeo, darkWoodMaterial);
    bridgeMesh.position.set(0, 0.1, 0.6); // Lower part of the body
    bridgeMesh.castShadow = true;
    bridgeMesh.receiveShadow = true;
    luteGroup.add(bridgeMesh);

    // 2. Neck
    const neckLen = 2.0;
    const neckGeo = new THREE.BoxGeometry(0.4, 0.15, neckLen);
    const neckMesh = new THREE.Mesh(neckGeo, darkWoodMaterial);
    // Position extending from the body
    // Body radius is 1.5, neck starts around -1.2 (overlapping)
    neckMesh.position.set(0, 0.05, -1.2 - neckLen/2);
    neckMesh.castShadow = true;
    neckMesh.receiveShadow = true;
    luteGroup.add(neckMesh);

    // Frets
    const numFrets = 8;
    for (let i = 0; i < numFrets; i++) {
        const fretGeo = new THREE.BoxGeometry(0.42, 0.02, 0.02);
        const fretMesh = new THREE.Mesh(fretGeo, stringMaterial);
        const fretZ = -1.2 - 0.2 - (i * (neckLen - 0.4) / numFrets);
        fretMesh.position.set(0, 0.13, fretZ);
        luteGroup.add(fretMesh);
    }

    // 3. Pegbox (Bent back sharply)
    const pegboxLen = 0.8;
    const pegboxGeo = new THREE.BoxGeometry(0.4, 0.2, pegboxLen);
    const pegboxMesh = new THREE.Mesh(pegboxGeo, darkWoodMaterial);
    // Attach to end of neck
    const pegboxZ = -1.2 - neckLen;
    // Lute pegboxes are angled back almost 90 degrees, but let's do ~60 deg.
    pegboxMesh.position.set(0, -0.2, pegboxZ - pegboxLen/2 * Math.cos(Math.PI/3));
    pegboxMesh.rotation.x = -Math.PI / 3;
    pegboxMesh.castShadow = true;
    pegboxMesh.receiveShadow = true;
    luteGroup.add(pegboxMesh);

    // Tuning Pegs
    for (let i = 0; i < 6; i++) {
        const pegGeo = new THREE.CylinderGeometry(0.04, 0.02, 0.6, 8);
        const pegMesh = new THREE.Mesh(pegGeo, darkWoodMaterial);
        // Pegs stick out the sides. Rotate them.
        pegMesh.rotation.z = Math.PI / 2;
        // Position along the pegbox
        // In pegbox local coordinates:
        const localZ = (i - 2.5) * (pegboxLen / 6);
        pegMesh.position.set(0, 0, localZ);
        pegboxMesh.add(pegMesh); // Add to pegbox so it inherits rotation
    }

    // 4. Strings (Simple lines/thin cylinders)
    const stringLen = 1.2 + neckLen - 0.6 + 0.2; // From bridge to nut
    for(let i=0; i<6; i++) {
        const sGeo = new THREE.CylinderGeometry(0.005, 0.005, stringLen, 4);
        const sMesh = new THREE.Mesh(sGeo, stringMaterial);
        sMesh.rotation.x = Math.PI / 2; // Lie flat along Z

        const offsetX = (i - 2.5) * 0.06;
        sMesh.position.set(offsetX, 0.16, -0.2 - stringLen/2 + 0.6);
        luteGroup.add(sMesh);
    }

    // --- Positioning ---
    // Table Top is Y = -2.75.
    // Let's lay the lute on the table or lean it against a chair.
    // If it lies flat, its deepest part (the bowl) extends to Y = -1.5 (radius) * 0.6 (scale) = -0.9.
    // So the group origin (Y=0) is 0.9 units above the lowest point.
    // To rest on the table, Group Y = -2.75 + 0.9 = -1.85.

    // Let's place it near the edge of the table, maybe leaning slightly.
    luteGroup.position.set(position.x, position.y, position.z);

    // Initial rotation if none provided (e.g. resting flat)
    if (rotationY === 0 && position.x === 0 && position.y === 0) {
        // Default table position
        luteGroup.position.set(-8, -1.85, 2);
        // Lay it flat, angled a bit
        luteGroup.rotation.set(0, Math.PI / 6, 0);
    } else {
        luteGroup.rotation.y = rotationY;
    }

    scene.add(luteGroup);

    // --- Physics ---
    if (physicsWorld) {
        // Approximate the whole thing with a box or compound shape.
        // A box covering the body and neck.
        // Body length ~3. Neck length ~2. Total ~5.
        // Body width ~3.
        // Depth (thickness) ~ 1.
        // Center offset: mostly towards body.

        // Simpler: Just a box for the body, and maybe a box for the neck if needed.
        // But createStaticBody just takes one shape. We can use a compound shape if we really want to.
        // For static clutter, a box covering the main body is usually enough to stop dice cleanly.
        const shape = new ammo.btBoxShape(new ammo.btVector3(1.5, 0.5, 2.5)); // Half sizes

        // The physics body will be centered on the group origin (0,0,0) which is center of the body.
        // This is perfectly fine for the Lute body.
        createStaticBody(physicsWorld, luteGroup, shape);
    }

    return luteGroup;
}
