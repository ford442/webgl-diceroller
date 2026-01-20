import * as THREE from 'three';

export function createTable(scene) {
    const width = 25;
    const height = 1; // Thickness of the table
    const depth = 25;
    const position = { x: 0, y: -2, z: 0 }; // Top surface at y = -1.5

    // Create a placeholder texture (1x1 pixel, SaddleBrown) to prevent "no image data" errors
    const placeholderData = new Uint8Array([139, 69, 19, 255]);
    const placeholderTexture = new THREE.DataTexture(placeholderData, 1, 1, THREE.RGBAFormat);
    placeholderTexture.colorSpace = THREE.SRGBColorSpace;
    placeholderTexture.needsUpdate = true;

    // Create Material
    // Using MeshStandardMaterial for PBR
    const material = new THREE.MeshStandardMaterial({
        map: placeholderTexture,
        roughness: 0.8,
        metalness: 0.1,
        color: 0x8B4513 // SaddleBrown tint to make it look rich
    });

    // Load real Texture asynchronously
    const loader = new THREE.TextureLoader();
    loader.load(
        '/images/wood.jpg',
        (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(4, 4);
            texture.colorSpace = THREE.SRGBColorSpace;

            material.map = texture;
            material.needsUpdate = true;
        },
        undefined,
        (err) => {
            console.error('Error loading table texture:', err);
        }
    );

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
