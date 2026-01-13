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
    // const rimY = -2.25; // World Y

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

    // Wood Material (Rims)
    const rimMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        roughnessMap: woodRoughness,
        bumpMap: woodBump,
        bumpScale: 0.05,
        color: 0xffffff,
        roughness: 0.7,
        metalness: 0.0
    });

    // Worn Wood Material (Rolling Surface)
    // Darker, more worn looking
    const surfaceDiffuse = woodDiffuse.clone();
    const surfaceRoughness = woodRoughness.clone();
    const surfaceBump = woodBump.clone();

    // Repeat texture more for the large surface
    surfaceDiffuse.repeat.set(2, 2);
    surfaceRoughness.repeat.set(2, 2);
    surfaceBump.repeat.set(2, 2);

    const surfaceMaterial = new THREE.MeshStandardMaterial({
        map: surfaceDiffuse,
        roughnessMap: surfaceRoughness,
        bumpMap: surfaceBump,
        bumpScale: 0.08, // Deeper grain
        color: 0x886644, // Darker, stained wood look
        roughness: 0.85, // Worn, non-shiny
        metalness: 0.0
    });

    const tableGroup = new THREE.Group();
    // Use Local Coordinates inside the Group which is at `position`.
    tableGroup.position.set(position.x, position.y, position.z);

    // 1. Floor (The rolling surface)
    // Box centered at 0,0,0 inside the group
    const floorGeometry = new THREE.BoxGeometry(width, height, depth);
    const floorMesh = new THREE.Mesh(floorGeometry, surfaceMaterial);
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
    const sideMaterial = rimMaterial.clone();
    sideMaterial.map = woodDiffuse.clone();
    sideMaterial.map.wrapS = THREE.RepeatWrapping;
    sideMaterial.map.wrapT = THREE.RepeatWrapping;
    sideMaterial.map.repeat.set(0.5, 4);

    const leftRim = new THREE.Mesh(sideRimGeometry, rimMaterial);
    leftRim.position.set(-(width/2 + rimWidth/2), localRimY, 0);
    leftRim.castShadow = true;
    leftRim.receiveShadow = true;
    tableGroup.add(leftRim);

    const rightRim = new THREE.Mesh(sideRimGeometry, rimMaterial);
    rightRim.position.set((width/2 + rimWidth/2), localRimY, 0);
    rightRim.castShadow = true;
    rightRim.receiveShadow = true;
    tableGroup.add(rightRim);

    // Top/Bottom Rims
    const topBotWidth = width + 2 * rimWidth;
    const topBotRimGeometry = new THREE.BoxGeometry(topBotWidth, rimHeight, rimWidth);

    const topRim = new THREE.Mesh(topBotRimGeometry, rimMaterial);
    topRim.position.set(0, localRimY, -(depth/2 + rimWidth/2));
    topRim.castShadow = true;
    topRim.receiveShadow = true;
    tableGroup.add(topRim);

    const botRim = new THREE.Mesh(topBotRimGeometry, rimMaterial);
    botRim.position.set(0, localRimY, (depth/2 + rimWidth/2));
    botRim.castShadow = true;
    botRim.receiveShadow = true;
    tableGroup.add(botRim);

    // 3. Legs (Visual Only)
    // Table bottom is at -0.25 local (-3.25 world).
    // Room floor is usually around -10 world.
    // Leg length needed: -3.25 - (-10) = 6.75. Let's make them 7 units long.
    // Position: Near the corners of the table (not rims).
    const legSize = 1.5;
    const legHeight = 7.0;
    const legGeometry = new THREE.BoxGeometry(legSize, legHeight, legSize);
    const legMaterial = rimMaterial; // Match rims

    // Center of leg vertically:
    // Top at -0.25. Center = -0.25 - legHeight/2 = -0.25 - 3.5 = -3.75.
    const legY = -3.75;
    const legOffset = width / 2 - legSize / 2; // Inset slightly

    const positions = [
        { x: -legOffset, z: -legOffset },
        { x: legOffset, z: -legOffset },
        { x: -legOffset, z: legOffset },
        { x: legOffset, z: legOffset }
    ];

    positions.forEach(pos => {
        const leg = new THREE.Mesh(legGeometry, legMaterial);
        leg.position.set(pos.x, legY, pos.z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        tableGroup.add(leg);
    });

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
