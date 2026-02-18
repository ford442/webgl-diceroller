import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createDiceTower(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'DiceTower';

    // Materials
    const loader = new THREE.TextureLoader();
    const woodDiffuse = loader.load('/images/wood_diffuse.jpg');
    const woodBump = loader.load('/images/wood_bump.jpg');
    const woodRoughness = loader.load('/images/wood_roughness.jpg');

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
        color: 0x8B5A2B, // Darker wood tint
        roughness: 0.8
    });

    // Dimensions
    const width = 6;
    const depth = 6;
    const height = 15;
    const thickness = 0.5;

    // --- Physics Compound Shape ---
    // We use a compound shape to represent the hollow tower and ramps
    const compoundShape = new ammo.btCompoundShape();

    // Helper to add parts
    function addPart(w, h, d, x, y, z, rotX=0, rotY=0, rotZ=0) {
        // Visual
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, woodMat);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rotX, rotY, rotZ);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        // Physics
        const shape = new ammo.btBoxShape(new ammo.btVector3(w/2, h/2, d/2));
        const transform = new ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new ammo.btVector3(x, y, z));

        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ));
        transform.setRotation(new ammo.btQuaternion(q.x, q.y, q.z, q.w));

        compoundShape.addChildShape(transform, shape);
    }

    // --- Tower Structure ---

    // 1. Back Wall
    addPart(width, height, thickness, 0, height/2, -depth/2 + thickness/2);

    // 2. Side Walls
    // Left
    addPart(thickness, height, depth, -width/2 + thickness/2, height/2, 0);
    // Right
    addPart(thickness, height, depth, width/2 - thickness/2, height/2, 0);

    // 3. Front Wall (Top Half)
    // Covers top section to hide initial drop mechanism/funnel effect
    const frontH = height / 3;
    addPart(width, frontH, thickness, 0, height - frontH/2, depth/2 - thickness/2);

    // --- Internal Ramps ---
    // Zig-zag pattern: Back->Front, Front->Back, Back->Front (Exit)
    const rampThick = 0.2;
    const rampW = width - thickness*2 - 0.1; // Fit inside walls with small margin
    const rampLen = depth * 0.9;

    // Ramp 1 (Top): Slopes down towards Front
    // Positioned high, angled down (+X rotation)
    addPart(rampW, rampThick, rampLen, 0, 11, -0.5, 0.6, 0, 0);

    // Ramp 2 (Middle): Slopes down towards Back
    // Positioned middle, angled down-back (-X rotation)
    addPart(rampW, rampThick, rampLen, 0, 7, 0.5, -0.6, 0, 0);

    // Ramp 3 (Bottom/Exit): Slopes down towards Front
    // Positioned low, leads to tray
    addPart(rampW, rampThick, rampLen + 1, 0, 3, -0.5, 0.6, 0, 0);

    // --- Catch Tray ---
    // Extends from the front of the tower to catch dice
    const trayDepth = 8;
    const trayHeight = 2;
    const trayZ = depth/2 + trayDepth/2 - thickness; // Center Z of tray floor

    // Tray Floor
    addPart(width, thickness, trayDepth, 0, thickness/2, trayZ);

    // Tray Side Walls
    addPart(thickness, trayHeight, trayDepth, -width/2 + thickness/2, trayHeight/2, trayZ);
    addPart(thickness, trayHeight, trayDepth, width/2 - thickness/2, trayHeight/2, trayZ);

    // Tray Front Wall
    addPart(width, trayHeight, thickness, 0, trayHeight/2, trayZ + trayDepth/2 - thickness/2);


    // --- Positioning ---
    // Place on the table (Table surface is at approx Y = -2.75)
    // Tower base is at Y=0 relative to group.
    group.position.set(8, -3.0, -8);

    // Rotate slightly for style
    group.rotation.y = -Math.PI / 6;

    scene.add(group);

    // Create Static Physics Body
    createStaticBody(physicsWorld, group, compoundShape);
}
