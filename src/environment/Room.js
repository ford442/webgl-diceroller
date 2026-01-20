import * as THREE from 'three';

export function createRoom(scene) {
    const loader = new THREE.TextureLoader();

    // Load textures
    const brickDiffuse = loader.load('./images/brick_diffuse.jpg');
    const brickBump = loader.load('./images/brick_bump.jpg');
    const brickRoughness = loader.load('./images/brick_roughness.jpg');

    // Texture settings
    [brickDiffuse, brickBump, brickRoughness].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(4, 4);
    });

    brickDiffuse.colorSpace = THREE.SRGBColorSpace;
    brickBump.colorSpace = THREE.NoColorSpace;
    brickRoughness.colorSpace = THREE.NoColorSpace;

    // Material
    const wallMaterial = new THREE.MeshStandardMaterial({
        map: brickDiffuse,
        bumpMap: brickBump,
        bumpScale: 0.1,
        roughnessMap: brickRoughness,
        side: THREE.BackSide // Render inside of the box
    });

    // Room Geometry (large box)
    const roomWidth = 50;
    const roomHeight = 30;
    const roomDepth = 50;

    const roomGeometry = new THREE.BoxGeometry(roomWidth, roomHeight, roomDepth);
    const roomMesh = new THREE.Mesh(roomGeometry, wallMaterial);

    // Position room so floor is below table
    // Table is at y=-3. Table height is 0.5. Top is at -2.75.
    // If we want room floor at -10.
    // Box center y = floorY + height/2 = -10 + 15 = 5.
    roomMesh.position.set(0, 5, 0);

    roomMesh.receiveShadow = true;
    // roomMesh.castShadow = true; // Walls casting shadows might be tricky if we are inside

    scene.add(roomMesh);

    // Add a separate floor plane for different texture if needed,
    // but for now the box covers everything.

    return {
        mesh: roomMesh
    };
}
