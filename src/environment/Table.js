import * as THREE from 'three';

export function createTable(scene) {
    // Dimensions
    const width = 20;
    const depth = 20;
    const height = 0.5;

    // Rim Dimensions
    const rimWidth = 1;
    const rimHeight = 2.0;
    // Rim center Y calculation:
    // Floor bottom at -3.25 (since center is -3, height 0.5)
    // We want rim bottom at -3.25.
    // Rim center = -3.25 + (rimHeight / 2) = -3.25 + 1.0 = -2.25.
    const rimY = -2.25;

    // Position
    const position = { x: 0, y: -3, z: 0 };

    // Texture Loader
    const textureLoader = new THREE.TextureLoader();

    // Wood Textures
    const woodDiffuse = textureLoader.load('/images/wood_diffuse.jpg');
    const woodRoughness = textureLoader.load('/images/wood_roughness.jpg');
    const woodBump = textureLoader.load('/images/wood_bump.jpg');

    [woodDiffuse, woodRoughness, woodBump].forEach(texture => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
    });
    // Fix color space for non-color maps
    woodRoughness.colorSpace = THREE.NoColorSpace;
    woodBump.colorSpace = THREE.NoColorSpace;

    // Wood Material
    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        roughnessMap: woodRoughness,
        bumpMap: woodBump,
        bumpScale: 0.05,
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0
    });

    // Felt Material (using wood bump map for texture)
    const feltBump = woodBump.clone(); // Clone to allow different repeat
    feltBump.repeat.set(4, 4);

    const feltMaterial = new THREE.MeshStandardMaterial({
        color: 0x355e3b, // Hunter Green
        roughness: 0.9,
        metalness: 0.0,
        bumpMap: feltBump,
        bumpScale: 0.02 // Subtle grain
    });

    const tableGroup = new THREE.Group();
    // No group position needed if we position elements globally,
    // BUT physics expects a "position" for the floor.
    // Let's keep the group at 0,0,0 and position elements relative to world coordinates
    // to match how we calculated positions.
    // Wait, previous implementation put group at `position` (-3).
    // Let's stick to global coordinates for clarity in mesh creation,
    // or local coords inside group.

    // Let's use Local Coordinates inside the Group which is at `position`.
    tableGroup.position.set(position.x, position.y, position.z);

    // 1. Floor (The rolling surface)
    // Box centered at 0,0,0 inside the group
    const floorGeometry = new THREE.BoxGeometry(width, height, depth);
    const floorMesh = new THREE.Mesh(floorGeometry, feltMaterial);
    floorMesh.receiveShadow = true;
    floorMesh.castShadow = true;
    tableGroup.add(floorMesh);

    // 2. Rims (Walls)
    // Local Rim Y:
    // Group Y is -3. Rim World Y is -2.25.
    // Local Rim Y = -2.25 - (-3) = 0.75.
    const localRimY = 0.75;

    // Side Rims (Left/Right)
    const sideRimGeometry = new THREE.BoxGeometry(rimWidth, rimHeight, depth);
    const sideMaterial = woodMaterial.clone();
    sideMaterial.map = woodDiffuse.clone();
    sideMaterial.map.wrapS = THREE.RepeatWrapping;
    sideMaterial.map.wrapT = THREE.RepeatWrapping;
    sideMaterial.map.repeat.set(0.5, 4);

    const leftRim = new THREE.Mesh(sideRimGeometry, woodMaterial);
    leftRim.position.set(-(width/2 + rimWidth/2), localRimY, 0);
    leftRim.castShadow = true;
    leftRim.receiveShadow = true;
    tableGroup.add(leftRim);

    const rightRim = new THREE.Mesh(sideRimGeometry, woodMaterial);
    rightRim.position.set((width/2 + rimWidth/2), localRimY, 0);
    rightRim.castShadow = true;
    rightRim.receiveShadow = true;
    tableGroup.add(rightRim);

    // Top/Bottom Rims
    const topBotWidth = width + 2 * rimWidth;
    const topBotRimGeometry = new THREE.BoxGeometry(topBotWidth, rimHeight, rimWidth);

    const topRim = new THREE.Mesh(topBotRimGeometry, woodMaterial);
    topRim.position.set(0, localRimY, -(depth/2 + rimWidth/2));
    topRim.castShadow = true;
    topRim.receiveShadow = true;
    tableGroup.add(topRim);

    const botRim = new THREE.Mesh(topBotRimGeometry, woodMaterial);
    botRim.position.set(0, localRimY, (depth/2 + rimWidth/2));
    botRim.castShadow = true;
    botRim.receiveShadow = true;
    tableGroup.add(botRim);

    scene.add(tableGroup);

    // Return configuration for physics
    return {
        width,
        height,
        depth,
        position,
        // Add wall config for physics.js
        walls: {
            thickness: rimWidth,
            height: rimHeight,
            offsetY: localRimY // Offset from floor center
        }
    };
}
