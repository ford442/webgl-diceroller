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
        t.repeat.set(4, 3); // Increased vertical repeat for taller walls
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
        t.repeat.set(1, 4);
    });

    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.1,
        roughnessMap: woodRoughness,
        color: 0xffffff,
        roughness: 0.8
    });

    const roomGroup = new THREE.Group();

    // Room Dimensions
    const width = 40;
    const depth = 40;
    const height = 30; // Increased Height for "Room" feel
    const thickness = 2;

    // Floor (Ground) - Below the table
    const floorY = -10;

    const floorGeo = new THREE.BoxGeometry(width, 1, depth);
    const floorMesh = new THREE.Mesh(floorGeo, wallMaterial);
    floorMesh.position.set(0, floorY, 0);
    floorMesh.receiveShadow = true;
    roomGroup.add(floorMesh);

    // Physics for floor
    const Ammo = getAmmo();
    if (Ammo) {
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(width/2, 0.5, depth/2));
        createStaticBody(physicsWorld, floorMesh, shape);
    }

    // Walls
    const wallCenterY = floorY + height / 2; // -10 + 15 = 5

    // Back Wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), wallMaterial);
    backWall.position.set(0, wallCenterY, -depth/2 - thickness/2);
    backWall.receiveShadow = true;
    roomGroup.add(backWall);
    // Physics
    if (Ammo) createStaticBody(physicsWorld, backWall, new Ammo.btBoxShape(new Ammo.btVector3(width/2, height/2, thickness/2)));

    // Right Wall (Solid)
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, depth + thickness*2), wallMaterial);
    rightWall.position.set(width/2 + thickness/2, wallCenterY, 0);
    rightWall.receiveShadow = true;
    roomGroup.add(rightWall);
    if (Ammo) createStaticBody(physicsWorld, rightWall, new Ammo.btBoxShape(new Ammo.btVector3(thickness/2, height/2, depth/2 + thickness)));

    // Left Wall (Windowed)
    const leftWallX = -width/2 - thickness/2;
    createWindowedWall(roomGroup, physicsWorld, Ammo, leftWallX, floorY, height, depth, thickness, wallMaterial, woodMaterial);


    // Beams / Decorations
    const beamThick = 1;
    // Top Beam (at top of walls)
    // Wall Top = -10 + 30 = 20.
    const topBeamY = floorY + height;

    // Horizontal Beam Back
    const beamBack = new THREE.Mesh(new THREE.BoxGeometry(width, beamThick, beamThick), woodMaterial);
    beamBack.position.set(0, 10, -depth/2 + beamThick/2); // Mid-height beam
    roomGroup.add(beamBack);

    // Vertical Columns in corners
    const colGeo = new THREE.BoxGeometry(beamThick, height, beamThick);

    const col1 = new THREE.Mesh(colGeo, woodMaterial);
    col1.position.set(-width/2 + beamThick/2, wallCenterY, -depth/2 + beamThick/2);
    roomGroup.add(col1);

    const col2 = new THREE.Mesh(colGeo, woodMaterial);
    col2.position.set(width/2 - beamThick/2, wallCenterY, -depth/2 + beamThick/2);
    roomGroup.add(col2);

    scene.add(roomGroup);
}

function createWindowedWall(group, physicsWorld, Ammo, xPos, floorY, wallHeight, wallDepth, thickness, wallMat, woodMat) {
    // Window Parameters
    const winWidth = 6;
    const winHeight = 10;
    const winZ = -5; // Centered at Z = -5
    const winY = 4;  // Centered at Y = 4 (approx 1.4m above table)

    // Wall Limits
    const zStart = -wallDepth / 2; // -20
    const zEnd = wallDepth / 2;    // 20
    const yStart = floorY;         // -10
    const yEnd = floorY + wallHeight; // 20

    // Window Hole Bounds
    const winZStart = winZ - winWidth / 2; // -8
    const winZEnd = winZ + winWidth / 2;   // -2
    const winYStart = winY - winHeight / 2; // -1
    const winYEnd = winY + winHeight / 2;   // 9

    // Segments
    // 1. Bottom (Full Depth, below window)
    const botHeight = winYStart - yStart; // -1 - (-10) = 9
    const botGeo = new THREE.BoxGeometry(thickness, botHeight, wallDepth + thickness*2);
    const botMesh = new THREE.Mesh(botGeo, wallMat);
    botMesh.position.set(xPos, yStart + botHeight/2, 0);
    botMesh.receiveShadow = true;
    group.add(botMesh);

    // 2. Top (Full Depth, above window)
    const topHeight = yEnd - winYEnd; // 20 - 9 = 11
    const topGeo = new THREE.BoxGeometry(thickness, topHeight, wallDepth + thickness*2);
    const topMesh = new THREE.Mesh(topGeo, wallMat);
    topMesh.position.set(xPos, winYEnd + topHeight/2, 0);
    topMesh.receiveShadow = true;
    group.add(topMesh);

    // 3. Front (Z > Window)
    const frontLength = zEnd - winZEnd; // 20 - (-2) = 22
    const midHeight = winHeight;
    const frontGeo = new THREE.BoxGeometry(thickness, midHeight, frontLength + thickness); // Extend slightly
    const frontMesh = new THREE.Mesh(frontGeo, wallMat);
    const frontZ = winZEnd + frontLength/2; // -2 + 11 = 9
    frontMesh.position.set(xPos, winY, frontZ);
    frontMesh.receiveShadow = true;
    group.add(frontMesh);

    // 4. Back (Z < Window)
    const backLength = winZStart - zStart; // -8 - (-20) = 12
    const backGeo = new THREE.BoxGeometry(thickness, midHeight, backLength + thickness);
    const backMesh = new THREE.Mesh(backGeo, wallMat);
    const backZ = zStart + backLength/2; // -20 + 6 = -14
    backMesh.position.set(xPos, winY, backZ);
    backMesh.receiveShadow = true;
    group.add(backMesh);

    // --- Window Frame ---
    const frameThick = 0.5;
    const frameDepth = 0.5;
    const frameMat = woodMat;
    const frameGroup = new THREE.Group();
    frameGroup.position.set(xPos, winY, winZ);

    // Top/Bot Frame
    const tbGeo = new THREE.BoxGeometry(thickness + 0.2, frameThick, winWidth);
    const topFrame = new THREE.Mesh(tbGeo, frameMat);
    topFrame.position.y = winHeight/2 - frameThick/2;
    frameGroup.add(topFrame);

    const botFrame = new THREE.Mesh(tbGeo, frameMat);
    botFrame.position.y = -winHeight/2 + frameThick/2;
    frameGroup.add(botFrame);

    // Side Frames
    const lrGeo = new THREE.BoxGeometry(thickness + 0.2, winHeight, frameThick);
    const leftFrame = new THREE.Mesh(lrGeo, frameMat);
    leftFrame.position.z = -winWidth/2 + frameThick/2;
    frameGroup.add(leftFrame);

    const rightFrame = new THREE.Mesh(lrGeo, frameMat);
    rightFrame.position.z = winWidth/2 - frameThick/2;
    frameGroup.add(rightFrame);

    // Cross Bars (Gothic Style - Simple Cross)
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, winHeight, 0.3), frameMat);
    frameGroup.add(vBar);

    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, winWidth), frameMat);
    hBar.position.y = 2; // Higher up
    frameGroup.add(hBar);

    group.add(frameGroup);

    // --- God Rays ---
    createGodRays(group, xPos, winY, winZ);


    // --- Physics ---
    // Single invisible wall for collision
    if (Ammo) {
        // Invisible mesh for debug/logic (optional, strict physics body doesn't need mesh)
        // But we need a transform.
        const physHeight = wallHeight;
        const physDepth = wallDepth + thickness*2;

        // We can just reuse the shape logic without a mesh if we had a helper,
        // but createStaticBody expects a mesh to get position/quat.
        // We'll create a dummy mesh.
        const dummyGeo = new THREE.BoxGeometry(thickness, physHeight, physDepth);
        const dummyMesh = new THREE.Mesh(dummyGeo, new THREE.MeshBasicMaterial({ visible: false }));
        dummyMesh.position.set(xPos, floorY + physHeight/2, 0);
        group.add(dummyMesh);

        const shape = new Ammo.btBoxShape(new Ammo.btVector3(thickness/2, physHeight/2, physDepth/2));
        createStaticBody(physicsWorld, dummyMesh, shape);
    }
}

function createGodRays(group, x, y, z) {
    // Texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');

    // Gradient: Transparent -> White -> Transparent
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, 'rgba(200, 220, 255, 0)');
    gradient.addColorStop(0.2, 'rgba(200, 220, 255, 0.15)'); // Subtle blue-ish
    gradient.addColorStop(1, 'rgba(200, 220, 255, 0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);

    // Material
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    // Geometry: Cone/Cylinder
    // Light is at (-40, 15, -5). Window at (-21, 4, -5). Target (0, -3, 0).
    // Ray direction is roughly (+1, -0.5, 0).
    const length = 40;
    const radiusTop = 3;   // Window size approx
    const radiusBottom = 6; // Spread
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 32, 1, true);

    // Cylinder is Y-up. We need to rotate it to point from Window to Room Center.
    // Window pos: (x, y, z) ~ (-21, 4, -5).
    // Target: (0, -3, 0).
    // Vector: (21, -7, 5).

    const mesh = new THREE.Mesh(geometry, material);

    // Position: Center of the ray.
    // Start: (-21, 4, -5). End: (0, -3, 0) extended?
    // Let's place it at Window and LookAt Target.
    // Cylinder center is at (0,0,0). Top is +height/2. Bottom is -height/2.
    // We want Top to be at window (or outside).
    // We want the light to flow DOWN.
    // So rotate X -90?

    mesh.position.set(x, y, z); // Window center
    mesh.lookAt(0, -3, 0);      // Look at table
    mesh.rotateX(-Math.PI / 2); // Rotate cylinder to align with look vector?
    // Cylinder axis is Y. LookAt aligns Z axis.
    // To align Y axis with Z axis: Rotate X 90 degrees.

    // Also, we want the window end (Top) to be at the window position.
    // Currently mesh center is at window. So it sticks out half way.
    // Shift geometry or mesh.
    mesh.translateY(-length/2 + 2); // Shift along local Y (which is the ray axis now)

    group.add(mesh);
}
