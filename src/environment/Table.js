import * as THREE from 'three';
import { ROOM_FLOOR_Y, TABLE_CENTER_Y } from '../core/SceneMetrics.js';

export function createTable(scene) {
    // ENLARGED Dimensions for more decoration space
    const width = 36;  // Was 20
    const depth = 36;  // Was 20
    const floorHeight = 0.5;

    // Rim Dimensions
    const rimWidth = 1.5;
    const rimHeight = 4.5;

    // Lip Dimensions (Inward overhang)
    const lipWidth = 2.0;
    const lipThickness = 0.5;

    // DICE AREA - Center velvet zone
    const diceZoneSize = 16; // 16x16 area for dice in center
    const diceZoneBorder = 0.5; // Raised border around dice zone

    // Position (World)
    const position = { x: 0, y: TABLE_CENTER_Y, z: 0 };

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
    woodRoughness.colorSpace = THREE.NoColorSpace;
    woodBump.colorSpace = THREE.NoColorSpace;

    // Table Surface Textures (outer area)
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

    const repeatX = 4;
    const repeatY = 4;
    [tableDiffuse, tableRoughness, tableNormal, tableAO].forEach(t => t.repeat.set(repeatX, repeatY));

    // VELVET Material for dice zone
    const velvetMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a0e0e, // Deep red velvet
        roughness: 0.95,
        metalness: 0.05,
        bumpScale: 0.02
    });

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

    // 1. Main Floor (large surface)
    const floorGeometry = new THREE.BoxGeometry(width, floorHeight, depth);
    floorGeometry.attributes.uv2 = floorGeometry.attributes.uv;
    const floorMesh = new THREE.Mesh(floorGeometry, surfaceMaterial);
    floorMesh.receiveShadow = true;
    floorMesh.castShadow = true;
    tableGroup.add(floorMesh);

    // 2. DICE ZONE - Velvet area in center (slightly raised)
    const diceZoneGeo = new THREE.BoxGeometry(diceZoneSize, floorHeight * 1.2, diceZoneSize);
    const diceZoneMesh = new THREE.Mesh(diceZoneGeo, velvetMaterial);
    diceZoneMesh.position.y = floorHeight * 0.1; // Slightly above main floor
    diceZoneMesh.receiveShadow = true;
    tableGroup.add(diceZoneMesh);

    // 3. Dice Zone Border (subtle raised edge)
    const borderGeo = new THREE.BoxGeometry(diceZoneSize + 0.2, floorHeight * 0.8, diceZoneSize + 0.2);
    const borderMesh = new THREE.Mesh(borderGeo, rimMaterial);
    borderMesh.position.y = floorHeight * 0.3;
    borderMesh.scale.set(1, 0.3, 1); // Flat border
    borderMesh.receiveShadow = true;
    tableGroup.add(borderMesh);

    // 4. Rims (Walls)
    const localRimY = -0.25 + (rimHeight / 2);

    const sideRimGeometry = new THREE.BoxGeometry(rimWidth, rimHeight, depth);
    const sideMaterial = rimMaterial.clone();
    sideMaterial.map = woodDiffuse.clone();
    sideMaterial.map.wrapS = THREE.RepeatWrapping;
    sideMaterial.map.wrapT = THREE.RepeatWrapping;
    sideMaterial.map.repeat.set(0.5, 6);

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

    // 5. Lips (Inward Overhang)
    const localLipY = -0.25 + rimHeight + lipThickness/2;

    const sideLipTotalWidth = rimWidth + lipWidth;
    const sideLipGeometry = new THREE.BoxGeometry(sideLipTotalWidth, lipThickness, depth);

    // Left Lip
    const leftLipX = -(width/2 + rimWidth) + (sideLipTotalWidth / 2);
    const leftLip = new THREE.Mesh(sideLipGeometry, rimMaterial);
    leftLip.position.set(leftLipX, localLipY, 0);
    leftLip.castShadow = true;
    leftLip.receiveShadow = true;
    tableGroup.add(leftLip);

    // Right Lip
    const rightLipX = (width/2 + rimWidth) - (sideLipTotalWidth / 2);
    const rightLip = new THREE.Mesh(sideLipGeometry, rimMaterial);
    rightLip.position.set(rightLipX, localLipY, 0);
    rightLip.castShadow = true;
    rightLip.receiveShadow = true;
    tableGroup.add(rightLip);

    // Top/Bottom Lips
    const topBotLipTotalDepth = rimWidth + lipWidth;
    const topBotLipLength = width + 2 * rimWidth;
    const topBotLipGeometry = new THREE.BoxGeometry(topBotLipLength, lipThickness, topBotLipTotalDepth);

    const topLipZ = -(depth/2 + rimWidth) + (topBotLipTotalDepth / 2);
    const topLip = new THREE.Mesh(topBotLipGeometry, rimMaterial);
    topLip.position.set(0, localLipY, topLipZ);
    topLip.castShadow = true;
    topLip.receiveShadow = true;
    tableGroup.add(topLip);

    const botLipZ = (depth/2 + rimWidth) - (topBotLipTotalDepth / 2);
    const botLip = new THREE.Mesh(topBotLipGeometry, rimMaterial);
    botLip.position.set(0, localLipY, botLipZ);
    botLip.castShadow = true;
    botLip.receiveShadow = true;
    tableGroup.add(botLip);

    // 6. Legs
    const legSize = 2.0;
    const legHeight = Math.max(1, position.y - floorHeight / 2 - ROOM_FLOOR_Y);
    const legGeometry = new THREE.BoxGeometry(legSize, legHeight, legSize);

    const legY = ROOM_FLOOR_Y + legHeight / 2 - position.y;
    const legOffset = width / 2 - legSize;

    const legPositions = [
        { x: -legOffset, z: -legOffset },
        { x: legOffset, z: -legOffset },
        { x: -legOffset, z: legOffset },
        { x: legOffset, z: legOffset }
    ];

    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeometry, rimMaterial);
        leg.position.set(pos.x, legY, pos.z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        tableGroup.add(leg);
    });

    scene.add(tableGroup);

    // --- Physics Definitions ---
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

    // 2. Walls (Invisible Collider Walls)
    const physicsWallHeight = 100.0;
    const worldWallY = position.y + (physicsWallHeight / 2) - 0.25;

    physicsBodies.push({
        type: 'box',
        size: { x: physicsWallThickness, y: physicsWallHeight, z: depth + physicsWallThickness*2 },
        position: { x: -(width/2 + physicsWallThickness/2), y: worldWallY, z: 0 },
        mass: 0
    });
    physicsBodies.push({
        type: 'box',
        size: { x: physicsWallThickness, y: physicsWallHeight, z: depth + physicsWallThickness*2 },
        position: { x: (width/2 + physicsWallThickness/2), y: worldWallY, z: 0 },
        mass: 0
    });
    physicsBodies.push({
        type: 'box',
        size: { x: width + physicsWallThickness*2, y: physicsWallHeight, z: physicsWallThickness },
        position: { x: 0, y: worldWallY, z: -(depth/2 + physicsWallThickness/2) },
        mass: 0
    });
    physicsBodies.push({
        type: 'box',
        size: { x: width + physicsWallThickness*2, y: physicsWallHeight, z: physicsWallThickness },
        position: { x: 0, y: worldWallY, z: (depth/2 + physicsWallThickness/2) },
        mass: 0
    });

    // 3. Lips
    const worldLipY = position.y + localLipY;

    physicsBodies.push({
        type: 'box',
        size: { x: sideLipTotalWidth, y: lipThickness, z: depth },
        position: { x: position.x + leftLipX, y: worldLipY, z: position.z },
        mass: 0
    });
    physicsBodies.push({
        type: 'box',
        size: { x: sideLipTotalWidth, y: lipThickness, z: depth },
        position: { x: position.x + rightLipX, y: worldLipY, z: position.z },
        mass: 0
    });
    physicsBodies.push({
        type: 'box',
        size: { x: topBotLipLength, y: lipThickness, z: topBotLipTotalDepth },
        position: { x: position.x, y: worldLipY, z: position.z + topLipZ },
        mass: 0
    });
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
        diceZoneSize,  // Export dice zone info for decoration placement
        physicsBodies
    };
}
