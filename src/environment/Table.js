import * as THREE from 'three';

export function createTable(scene) {
    const width = 25;
    const height = 1; // Thickness of the table
    const depth = 25;
    const position = { x: 0, y: -2, z: 0 }; // Top surface at y = -1.5

    // Load Textures
    const loader = new THREE.TextureLoader();

    const diffMap = loader.load('images/table_diff.jpg');
    const normalMap = loader.load('images/table_nor.jpg');
    const roughMap = loader.load('images/table_rough.jpg');
    const aoMap = loader.load('images/table_ao.jpg');

    const textures = [diffMap, normalMap, roughMap, aoMap];

    textures.forEach(tex => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2); // Adjusted for better scale
        tex.colorSpace = THREE.SRGBColorSpace;
    });

    // Normal map doesn't need sRGB encoding usually, but Three.js handles it automatically based on usage in standard material?
    // Actually for normal maps, we usually don't want sRGB.
    // loader.load automatically assigns SRGBColorSpace if we don't specify, but for data textures (normal, roughness, ao), linear is often preferred.
    // However, THREE.TextureLoader doesn't guess. We manually set it.
    // Let's reset color space for data maps to NoColorSpace (Linear) just to be safe,
    // though StandardMaterial might handle it.
    // In recent Three.js, colorSpace property is used.

    diffMap.colorSpace = THREE.SRGBColorSpace;
    normalMap.colorSpace = THREE.NoColorSpace; // Normal maps are linear data
    roughMap.colorSpace = THREE.NoColorSpace;
    aoMap.colorSpace = THREE.NoColorSpace;

    // Create Material
    const material = new THREE.MeshStandardMaterial({
        map: diffMap,
        normalMap: normalMap,
        roughnessMap: roughMap,
        aoMap: aoMap,
        roughness: 1.0, // Let the map control it
        metalness: 0.0, // Wood is dielectric
        color: 0xffffff // White so texture color shows through, or slightly tinted?
    });

    // Create Mesh
    const geometry = new THREE.BoxGeometry(width, height, depth);
    // Add UV2 for AO map
    geometry.attributes.uv2 = geometry.attributes.uv;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    scene.add(mesh);

    return {
        mesh,
        width,
        height,
        depth,
        position
    };
}
