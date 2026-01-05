import * as THREE from 'three';

export function createTable(scene) {
    const width = 25;
    const height = 1; // Thickness of the table
    const depth = 25;
    const position = { x: 0, y: -1.0, z: 0 }; // Top surface at y = -0.5

    // Load Textures
    const loader = new THREE.TextureLoader();

    const diffMap = loader.load('images/wood_diffuse.jpg');
    const bumpMap = loader.load('images/wood_bump.jpg');
    const roughMap = loader.load('images/wood_roughness.jpg');

    [diffMap, bumpMap, roughMap].forEach(tex => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 4);
    });

    diffMap.colorSpace = THREE.SRGBColorSpace;

    // Create Material
    // Using MeshStandardMaterial for PBR
    const material = new THREE.MeshStandardMaterial({
        map: diffMap,
        bumpMap: bumpMap,
        bumpScale: 0.1, // Slight bump
        roughnessMap: roughMap,
        roughness: 1.0, // Base roughness, modulated by map
        metalness: 0.0, // Wood is dielectric
        color: 0xffffff // White to show texture colors
    });

    // Create Mesh
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    scene.add(mesh);

    // Candle / Atmosphere Light
    // A warm point light to simulate a nearby candle or lantern
    const candleLight = new THREE.PointLight(0xffaa00, 2, 20); // Orange-ish, intensity 2, distance 20
    candleLight.position.set(0, 3, 0); // Positioned above the center
    candleLight.castShadow = true;
    candleLight.shadow.mapSize.width = 1024;
    candleLight.shadow.mapSize.height = 1024;
    candleLight.shadow.bias = -0.001;
    scene.add(candleLight);

    return {
        mesh,
        width,
        height,
        depth,
        position
    };
}
