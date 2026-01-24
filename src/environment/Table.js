import * as THREE from 'three';

export function createTable(scene) {
    // Dimensions
    const width = 20;
    const depth = 20;
    const floorHeight = 0.5;

    // Rim Dimensions - Updated per requirements
    const rimWidth = 1;
    const rimHeight = 4.0; // Increased to 4 units

    // Lip Dimensions (Inward overhang)
    const lipWidth = 1.5; // Extends inward
    const lipThickness = 0.5;

    // Position (World)
    const position = { x: 0, y: -3, z: 0 };

    // Texture Loader
    const textureLoader = new THREE.TextureLoader();

    // Wood Textures (Rims & Legs)
    const woodDiffuse = textureLoader.load('./images/wood_diffuse.jpg');
    const woodRoughness = textureLoader.load('./images/wood_roughness.jpg');
    const woodBump = textureLoader.load('./images/wood_bump.jpg');

    [woodDiffuse, woodRoughness, woodBump].forEach(texture => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
    });
    // Fix color space for non-color maps
    woodRoughness.colorSpace = THREE.NoColorSpace;
    woodBump.colorSpace = THREE.NoColorSpace;

    // Table Textures (Rolling Surface)
    const tableDiffuse = textureLoader.load('./images/table_diff.jpg');
    const tableRoughness = textureLoader.load('./images/table_rough.jpg');
    const tableNormal = textureLoader.load('./images/table_nor.jpg');
    const tableAO = textureLoader.load('./images/table_ao.jpg');

    [tableDiffuse, tableRoughness, tableNormal, tableAO].forEach(texture => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.NoColorSpace;
    });
    tableDiffuse.colorSpace = THREE.SRGBColorSpace;

    const repeatX = 2;
    const repeatY = 2;
    [tableDiffuse, tableRoughness, tableNormal, tableAO].forEach(t => t.repeat.set(repeatX, repeatY));

    // Materials
    const rimMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        roughnessMap: woodRoughness,
        bumpMap: woodBump,
        bumpScale: 0.05,
        color: 0xffffff,
        roughness: 0.7,
        metalness: 0.0
    });

    const surfaceMaterial = new THREE.MeshStandardMaterial({
        map: tableDiffuse,
        roughnessMap: tableRoughness,
        normalMap: tableNormal,
        normalScale: new THREE.Vector2(1, 1),
        aoMap: tableAO,
        aoMapIntensity: 1.0,
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0.0
    });

    const tableGroup = new THREE.Group();
    tableGroup.position.set(position.x, position.y, position.z);

    // --- Geometry Construction ---

    // 1. Floor
    const floorGeometry = new THREE.BoxGeometry(width, floorHeight, depth);
    floorGeometry.attributes.uv2 = floorGeometry.attributes.uv; // For AO
    const floorMesh = new THREE.Mesh(floorGeometry, surfaceMaterial);
    floorMesh.receiveShadow = true;
    floorMesh.castShadow = true;
    tableGroup.add(floorMesh);

    // 2. Rims (Walls)
    // Align rim bottom with floor bottom.
    // Floor is centered at 0 (local). Height 0.5. Bottom is -0.25.
    // Rim Height 4. Bottom -0.25. Center = -0.25 + 2 = 1.75.
    const localRimY = -0.25 + (rimHeight / 2);

    const sideRimGeometry = new THREE.BoxGeometry(rimWidth, rimHeight, depth);
    const sideMaterial = rimMaterial.clone();
    sideMaterial.map = woodDiffuse.clone();
    sideMaterial.map.wrapS = THREE.RepeatWrapping;
    sideMaterial.map.wrapT = THREE.RepeatWrapping;
    sideMaterial.map.repeat.set(0.5, 4);

    // Left Rim
    const leftRim = new THREE.Mesh(sideRimGeometry, rimMaterial);
    leftRim.position.set(-(width/2 + rimWidth/2), localRimY, 0);
    leftRim.castShadow = true;
    leftRim.receiveShadow = true;
    tableGroup.add(leftRim);

    // Right Rim
    const rightRim = new THREE.Mesh(sideRimGeometry, rimMaterial);
    rightRim.position.set((width/2 + rimWidth/2), localRimY, 0);
    rightRim.castShadow = true;
    rightRim.receiveShadow = true;
    tableGroup.add(rightRim);

    // Top/Bottom Rims (Full Width including side rims)
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

    // 3. Lips (Inward Overhang)
    // Sit on top of rims.
    // Rim Top = -0.25 + 4 = 3.75.
    // Lip Center = 3.75 + lipThickness/2 = 4.0.
    const localLipY = 4.0;

    // We want the lip to overhang INWARD.
    // Side Lips:
    // Attached to Left Rim: X center should shift inward.
    // Left Rim Center X: -(width/2 + rimWidth/2).
    // Lip Width: rimWidth + lipWidth (covers rim + overhang).
    // Lip Center X: LeftRimX + (lipWidth)/2 ?
    // Left Rim X is -10.5.
    // We want Lip to cover from -11 (outer edge) to -10 + 1.5 = -8.5?
    // Let's make Lip dimension `rimWidth + lipWidth`.
    // Outer edge aligns with Rim Outer Edge.
    // Rim Outer Edge X = -10.5 - 0.5 = -11.
    // Lip Width = 1 + 1.5 = 2.5.
    // Lip Center X = -11 + 1.25 = -9.75.

    const sideLipTotalWidth = rimWidth + lipWidth;
    const sideLipGeometry = new THREE.BoxGeometry(sideLipTotalWidth, lipThickness, depth); // Span depth of table

    // Left Lip
    const leftLip = new THREE.Mesh(sideLipGeometry, rimMaterial);
    // Outer edge at -(width/2 + rimWidth).
    // Center = Outer + width/2
    const leftLipX = -(width/2 + rimWidth) + (sideLipTotalWidth / 2);
    leftLip.position.set(leftLipX, localLipY, 0);
    leftLip.castShadow = true;
    leftLip.receiveShadow = true;
    tableGroup.add(leftLip);

    // Right Lip
    const rightLip = new THREE.Mesh(sideLipGeometry, rimMaterial);
    const rightLipX = (width/2 + rimWidth) - (sideLipTotalWidth / 2);
    rightLip.position.set(rightLipX, localLipY, 0);
    rightLip.castShadow = true;
    rightLip.receiveShadow = true;
    tableGroup.add(rightLip);

    // Top/Bottom Lips
    // Need to span the full width including the side lips? Or just fit between?
    // Let's span full width to look seamless (corners might overlap, which is fine visually).
    const topBotLipTotalDepth = rimWidth + lipWidth;
    const topBotLipLength = width + 2 * rimWidth; // Same as topBotRim
    const topBotLipGeometry = new THREE.BoxGeometry(topBotLipLength, lipThickness, topBotLipTotalDepth);

    // Top Lip (Back)
    const topLip = new THREE.Mesh(topBotLipGeometry, rimMaterial);
    // Outer edge Z = -(depth/2 + rimWidth)
    const topLipZ = -(depth/2 + rimWidth) + (topBotLipTotalDepth / 2);
    topLip.position.set(0, localLipY, topLipZ);
    topLip.castShadow = true;
    topLip.receiveShadow = true;
    tableGroup.add(topLip);

    // Bottom Lip (Front)
    const botLip = new THREE.Mesh(topBotLipGeometry, rimMaterial);
    const botLipZ = (depth/2 + rimWidth) - (topBotLipTotalDepth / 2);
    botLip.position.set(0, localLipY, botLipZ);
    botLip.castShadow = true;
    botLip.receiveShadow = true;
    tableGroup.add(botLip);


    // 4. Legs (Visual)
    const legSize = 1.5;
    const legHeight = 7.0;
    const legGeometry = new THREE.BoxGeometry(legSize, legHeight, legSize);

    // Leg Top at -0.25 (Floor Bottom).
    // Leg Center = -0.25 - 3.5 = -3.75.
    const legY = -3.75;
    const legOffset = width / 2 - legSize / 2;

    const positions = [
        { x: -legOffset, z: -legOffset },
        { x: legOffset, z: -legOffset },
        { x: -legOffset, z: legOffset },
        { x: legOffset, z: legOffset }
    ];

    positions.forEach(pos => {
        const leg = new THREE.Mesh(legGeometry, rimMaterial);
        leg.position.set(pos.x, legY, pos.z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        tableGroup.add(leg);
    });

    scene.add(tableGroup);

    // --- Physics Definitions (World Coordinates) ---
    const physicsBodies = [];
    const physicsWallThickness = 20;

    // 1. Floor
    physicsBodies.push({
        type: 'box',
        size: { x: width, y: floorHeight, z: depth },
        position: { x: position.x, y: position.y, z: position.z },
        mass: 0,
        friction: 0.6,
        restitution: 0.5
    });

    // 2. Walls (Thickened for safety)
    // Left Wall
    // Visual Inner X = -10.
    // Physics Inner X should be -10.
    // Physics Center X = -10 - (thickness/2) = -20.
    // World Y: LocalRimY is center of visual wall.
    // Visual Wall Height 4. Center local 1.75. World -3 + 1.75 = -1.25.
    // We can use same Y and height, just thicker.
    const worldWallY = position.y + localRimY;

    physicsBodies.push({
        type: 'box',
        size: { x: physicsWallThickness, y: rimHeight, z: depth + physicsWallThickness*2 }, // Extend depth to close corners
        position: { x: -(width/2 + physicsWallThickness/2), y: worldWallY, z: 0 },
        mass: 0
    });
    // Right Wall
    physicsBodies.push({
        type: 'box',
        size: { x: physicsWallThickness, y: rimHeight, z: depth + physicsWallThickness*2 },
        position: { x: (width/2 + physicsWallThickness/2), y: worldWallY, z: 0 },
        mass: 0
    });
    // Top Wall (Back)
    physicsBodies.push({
        type: 'box',
        size: { x: width + physicsWallThickness*2, y: rimHeight, z: physicsWallThickness },
        position: { x: 0, y: worldWallY, z: -(depth/2 + physicsWallThickness/2) },
        mass: 0
    });
    // Bottom Wall (Front)
    physicsBodies.push({
        type: 'box',
        size: { x: width + physicsWallThickness*2, y: rimHeight, z: physicsWallThickness },
        position: { x: 0, y: worldWallY, z: (depth/2 + physicsWallThickness/2) },
        mass: 0
    });

    // 3. Lips (Overhangs)
    // These need to match visual dimensions exactly to catch dice.
    const worldLipY = position.y + localLipY;

    // Left Lip
    physicsBodies.push({
        type: 'box',
        size: { x: sideLipTotalWidth, y: lipThickness, z: depth },
        position: { x: position.x + leftLipX, y: worldLipY, z: position.z },
        mass: 0
    });
    // Right Lip
    physicsBodies.push({
        type: 'box',
        size: { x: sideLipTotalWidth, y: lipThickness, z: depth },
        position: { x: position.x + rightLipX, y: worldLipY, z: position.z },
        mass: 0
    });
    // Top Lip
    physicsBodies.push({
        type: 'box',
        size: { x: topBotLipLength, y: lipThickness, z: topBotLipTotalDepth },
        position: { x: position.x, y: worldLipY, z: position.z + topLipZ },
        mass: 0
    });
    // Bot Lip
    physicsBodies.push({
        type: 'box',
        size: { x: topBotLipLength, y: lipThickness, z: topBotLipTotalDepth },
        position: { x: position.x, y: worldLipY, z: position.z + botLipZ },
        mass: 0
    });

    return {
        width,
        height: floorHeight,
        depth,
        position,
        physicsBodies // New export
    };
}
