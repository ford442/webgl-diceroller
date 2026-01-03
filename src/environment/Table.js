import * as THREE from 'three';

export function createTable(scene) {
    const width = 25;
    const height = 1; // Thickness of the table
    const depth = 25;
    const position = { x: 0, y: -2, z: 0 }; // Top surface at y = -1.5

    // Load Texture
    const loader = new THREE.TextureLoader();
    const texture = loader.load('images/wood.jpg');
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    texture.colorSpace = THREE.SRGBColorSpace;

    // Create Material
    // Using MeshStandardMaterial for PBR
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0.1,
        color: 0x8B4513 // SaddleBrown tint to make it look rich
    });

    // Create Mesh
    const geometry = new THREE.BoxGeometry(width, height, depth);
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
