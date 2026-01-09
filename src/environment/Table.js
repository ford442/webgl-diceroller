import * as THREE from 'three';

export function createTable(scene) {
    // Dimensions
    const width = 20;
    const depth = 20;
    const height = 0.5;

    // Position
    const position = { x: 0, y: -3, z: 0 };

    // Texture Loader
    const textureLoader = new THREE.TextureLoader();
    const diffuseMap = textureLoader.load('/images/wood_diffuse.jpg');
    const roughnessMap = textureLoader.load('/images/wood_roughness.jpg');
    const bumpMap = textureLoader.load('/images/wood_bump.jpg');

    // Configure textures
    [diffuseMap, roughnessMap, bumpMap].forEach(texture => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2); // Repeat texture 2x2 times across the table
        texture.colorSpace = THREE.SRGBColorSpace;
    });
    // Bump/Roughness maps should be linear, not sRGB. Three.js handles this automatically if we don't set SRGBColorSpace on them,
    // but diffuseMap definitely needs it.
    roughnessMap.colorSpace = THREE.NoColorSpace;
    bumpMap.colorSpace = THREE.NoColorSpace;

    // Material
    const material = new THREE.MeshStandardMaterial({
        map: diffuseMap,
        roughnessMap: roughnessMap,
        bumpMap: bumpMap,
        bumpScale: 0.05,
        color: 0xffffff, // White to let texture color show through
        roughness: 1.0,  // Base roughness
        metalness: 0.0
    });

    // Geometry
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const tableMesh = new THREE.Mesh(geometry, material);

    tableMesh.position.set(position.x, position.y, position.z);
    tableMesh.receiveShadow = true;
    tableMesh.castShadow = true;

    scene.add(tableMesh);

    // Return configuration for physics
    // Returning flat properties to match physics.js expectation
    return {
        width,
        height,
        depth,
        position
    };
}
