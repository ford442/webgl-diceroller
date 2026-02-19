import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createDiceJail(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'DiceJail';

    // --- Materials ---
    const loader = new THREE.TextureLoader();
    const woodDiffuse = loader.load('./images/wood_diffuse.jpg');
    const woodBump = loader.load('./images/wood_bump.jpg');
    const woodRoughness = loader.load('./images/wood_roughness.jpg');

    [woodDiffuse, woodBump, woodRoughness].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = (t === woodDiffuse) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    });

    const woodMat = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.1,
        roughnessMap: woodRoughness,
        color: 0x5c4033, // Darker wood
        roughness: 0.8
    });

    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x444444,
        metalness: 0.8,
        roughness: 0.4
    });

    const signMat = createSignMaterial();

    // --- Dimensions ---
    const size = 2.0;
    const height = 2.0;
    const thickness = 0.2;
    const barRadius = 0.05;

    // --- Visuals ---

    // 1. Base
    const baseGeo = new THREE.BoxGeometry(size, thickness, size);
    const baseMesh = new THREE.Mesh(baseGeo, woodMat);
    baseMesh.position.y = thickness / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Top
    const topMesh = new THREE.Mesh(baseGeo, woodMat);
    topMesh.position.y = height - thickness / 2;
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    group.add(topMesh);

    // 3. Bars
    // 3 bars per side (excluding corners) + 4 corners = 16 bars?
    // Let's do 2 bars per side evenly spaced.
    // Corners are posts.
    const postRadius = 0.1;
    const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, height - 2*thickness, 8);
    const barGeo = new THREE.CylinderGeometry(barRadius, barRadius, height - 2*thickness, 8);

    const barY = height / 2;
    const halfSize = size / 2;

    // Corner Posts
    const corners = [
        { x: -halfSize + postRadius, z: -halfSize + postRadius },
        { x: halfSize - postRadius, z: -halfSize + postRadius },
        { x: -halfSize + postRadius, z: halfSize - postRadius },
        { x: halfSize - postRadius, z: halfSize - postRadius }
    ];

    corners.forEach(pos => {
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(pos.x, barY, pos.z);
        post.castShadow = true;
        post.receiveShadow = true;
        group.add(post);
    });

    // Bars (Iron)
    // Front/Back: Z = +/- (halfSize - postRadius) ? No, inline with posts.
    // Side: X = +/- ...
    // Let's place 2 bars between posts on each side.
    // Distance between posts is size - 2*postRadius.
    // Spacing for 2 bars: divide by 3.
    const innerSpace = size - 2 * postRadius;
    const step = innerSpace / 3;

    // Front/Back (Z fixed)
    [-1, 1].forEach(side => {
        const z = side * (halfSize - postRadius);
        for (let i = 1; i <= 2; i++) {
            const x = -halfSize + postRadius + i * step;
            const bar = new THREE.Mesh(barGeo, metalMat);
            bar.position.set(x, barY, z);
            bar.castShadow = true;
            bar.receiveShadow = true;
            group.add(bar);
        }
    });

    // Left/Right (X fixed)
    [-1, 1].forEach(side => {
        const x = side * (halfSize - postRadius);
        for (let i = 1; i <= 2; i++) {
            const z = -halfSize + postRadius + i * step;
            const bar = new THREE.Mesh(barGeo, metalMat);
            bar.position.set(x, barY, z);
            bar.castShadow = true;
            bar.receiveShadow = true;
            group.add(bar);
        }
    });

    // 4. Sign "JAIL"
    // Hanging from top bars? Or stuck on top?
    // Let's put it on the Front Top.
    const signGeo = new THREE.BoxGeometry(0.8, 0.4, 0.05);
    const signMesh = new THREE.Mesh(signGeo, signMat);
    // Center of Front Face: Z = halfSize. Y = height - thickness/2.
    signMesh.position.set(0, height - thickness/2, halfSize + 0.03);
    // Tilt slightly
    signMesh.rotation.x = -0.1;
    group.add(signMesh);


    // --- Physics (Compound Shape) ---
    // Hollow box to allow dice inside (theoretically)
    if (ammo) {
        const compoundShape = new ammo.btCompoundShape();

        // Helper
        function addShape(s, px, py, pz) {
            const transform = new ammo.btTransform();
            transform.setIdentity();
            transform.setOrigin(new ammo.btVector3(px, py, pz));
            compoundShape.addChildShape(transform, s);
        }

        // Base
        const baseShape = new ammo.btBoxShape(new ammo.btVector3(size/2, thickness/2, size/2));
        addShape(baseShape, 0, thickness/2, 0);

        // Top
        const topShape = new ammo.btBoxShape(new ammo.btVector3(size/2, thickness/2, size/2));
        addShape(topShape, 0, height - thickness/2, 0);

        // Walls (Invisible colliders)
        // Thickness 0.1
        const wallThick = 0.1;
        const wallH = height - 2*thickness;
        const wallShapeFB = new ammo.btBoxShape(new ammo.btVector3(size/2, wallH/2, wallThick/2));
        const wallShapeLR = new ammo.btBoxShape(new ammo.btVector3(wallThick/2, wallH/2, size/2));

        // Front (Z+)
        addShape(wallShapeFB, 0, height/2, halfSize - wallThick/2);
        // Back (Z-)
        addShape(wallShapeFB, 0, height/2, -halfSize + wallThick/2);
        // Left (X-)
        addShape(wallShapeLR, -halfSize + wallThick/2, height/2, 0);
        // Right (X+)
        addShape(wallShapeLR, halfSize - wallThick/2, height/2, 0);

        // Position on Table
        // Table Top -2.75.
        // Group Origin is at Bottom Corner (0,0,0) of the cage local space.
        // Base is at 0...thickness.
        // So Group Y should be -2.75.
        group.position.set(-8, -2.75, 5);

        // Rotate to face center
        group.rotation.y = Math.PI / 4;

        scene.add(group);
        createStaticBody(physicsWorld, group, compoundShape);
    }

    return group;
}

function createSignMaterial() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Background wood-ish
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, 0, 256, 128);

    // Border
    ctx.strokeStyle = '#5c4033';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 118);

    // Text
    ctx.fillStyle = '#000000'; // Burnt text
    ctx.font = 'bold 60px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JAIL', 128, 64);

    // Grunge
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for(let i=0; i<20; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 128;
        const r = Math.random() * 10;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI*2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    return new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        color: 0xffffff
    });
}
