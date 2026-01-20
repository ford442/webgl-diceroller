import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createTavernWalls(scene, physicsWorld) {
    const loader = new THREE.TextureLoader();

    // --- Brick Material (Walls & Floor) ---
    const brickDiffuse = loader.load('./images/brick_diffuse.jpg');
    const brickBump = loader.load('./images/brick_bump.jpg');
    const brickRoughness = loader.load('./images/brick_roughness.jpg');

    [brickDiffuse, brickBump, brickRoughness].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = (t === brickDiffuse) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        // Scale texture for walls
        t.repeat.set(4, 2);
    });

    const wallMaterial = new THREE.MeshStandardMaterial({
        map: brickDiffuse,
        bumpMap: brickBump,
        bumpScale: 0.2,
        roughnessMap: brickRoughness,
        color: 0xaaaaaa // Slight dim, but let texture show
    });

    // --- Wood Material (Beams & Columns) ---
    const woodDiffuse = loader.load('./images/wood_diffuse.jpg');
    const woodBump = loader.load('./images/wood_bump.jpg');
    const woodRoughness = loader.load('./images/wood_roughness.jpg');

    [woodDiffuse, woodBump, woodRoughness].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = (t === woodDiffuse) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.repeat.set(1, 4); // Wood grain often runs along the length
    });

    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.1,
        roughnessMap: woodRoughness,
        color: 0xffffff, // White to show full texture color
        roughness: 0.8
    });

    const roomGroup = new THREE.Group();

    // Room Dimensions
    const width = 40;
    const depth = 40;
    const height = 15;
    const thickness = 2;

    // Floor (Ground) - Below the table
    // Table is at y=-3. Table legs go down to ~-10.
    const floorY = -10;

    const floorGeo = new THREE.BoxGeometry(width, 1, depth);
    const floorMesh = new THREE.Mesh(floorGeo, wallMaterial);
    floorMesh.position.set(0, floorY, 0);
    floorMesh.receiveShadow = true;
    roomGroup.add(floorMesh);

    // Physics for floor
    const ammo = getAmmo();
    if (ammo) {
        const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, 0.5, depth/2));
        createStaticBody(physicsWorld, floorMesh, shape);
    }

    // Walls
    // Back Wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), wallMaterial);
    backWall.position.set(0, floorY + height/2, -depth/2 - thickness/2);
    backWall.receiveShadow = true;
    roomGroup.add(backWall);
    // Physics
    if (ammo) createStaticBody(physicsWorld, backWall, new ammo.btBoxShape(new ammo.btVector3(width/2, height/2, thickness/2)));

    // Left Wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, depth + thickness*2), wallMaterial);
    leftWall.position.set(-width/2 - thickness/2, floorY + height/2, 0);
    leftWall.receiveShadow = true;
    roomGroup.add(leftWall);
    if (ammo) createStaticBody(physicsWorld, leftWall, new ammo.btBoxShape(new ammo.btVector3(thickness/2, height/2, depth/2 + thickness)));

    // Right Wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, depth + thickness*2), wallMaterial);
    rightWall.position.set(width/2 + thickness/2, floorY + height/2, 0);
    rightWall.receiveShadow = true;
    roomGroup.add(rightWall);
    if (ammo) createStaticBody(physicsWorld, rightWall, new ammo.btBoxShape(new ammo.btVector3(thickness/2, height/2, depth/2 + thickness)));

    // Beams / Decorations
    // Horizontal Beams along the walls
    const beamThick = 1;
    const beamGeo = new THREE.BoxGeometry(width, beamThick, beamThick);

    // Adjust UVs for beam (long horizontal)
    // We can't easily change UVs per instance with one material if we baked repeats,
    // but cloning the material or geometry with different UVs is cleaner.
    // For simplicity, we'll use the vertically repeated wood and hope it looks like cross-grain or just acceptable.
    // Ideally we'd rotate the texture. Let's try to rotate the texture for horizontal beams?
    // Or just accept it. Let's just create the mesh.

    const beam = new THREE.Mesh(beamGeo, woodMaterial);
    beam.position.set(0, floorY + height/2, -depth/2 + beamThick/2);
    roomGroup.add(beam);

    // Vertical Columns in corners
    const colGeo = new THREE.BoxGeometry(beamThick, height, beamThick);

    const col1 = new THREE.Mesh(colGeo, woodMaterial);
    col1.position.set(-width/2 + beamThick/2, floorY + height/2, -depth/2 + beamThick/2);
    roomGroup.add(col1);

    const col2 = new THREE.Mesh(colGeo, woodMaterial);
    col2.position.set(width/2 - beamThick/2, floorY + height/2, -depth/2 + beamThick/2);
    roomGroup.add(col2);

    scene.add(roomGroup);
}
