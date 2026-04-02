import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

/**
 * Creates a "Lockpicks and Pouch" prop for the tabletop environment.
 * Features procedural leather textures and metallic lockpicks.
 */
export function createLockpicks(scene, physicsWorld, position = { x: 4.5, y: -2.75, z: 0.5 }, rotationY = Math.PI / 8) {
    const group = new THREE.Group();
    group.name = 'Lockpicks';

    // 1. Leather Pouch (Open/Unrolled)
    // We'll use a thin box for the unrolled leather piece
    const pouchWidth = 1.2;
    const pouchLength = 2.0;
    const pouchThickness = 0.05;

    // Generate procedural leather texture
    const { diffuseMap: leatherDiffuse, roughnessMap: leatherRoughness, bumpMap: leatherBump } = generateLeatherTextures();

    const leatherMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a2e15, // Dark worn leather
        map: leatherDiffuse,
        roughnessMap: leatherRoughness,
        bumpMap: leatherBump,
        bumpScale: 0.03,
        roughness: 0.8,
        metalness: 0.05
    });

    // Main pouch body
    const pouchGeometry = new THREE.BoxGeometry(pouchWidth, pouchThickness, pouchLength);
    const pouchMesh = new THREE.Mesh(pouchGeometry, leatherMaterial);
    pouchMesh.receiveShadow = true;
    pouchMesh.castShadow = true;

    // Add slightly rolled edges to the pouch
    const rollGeometry = new THREE.CylinderGeometry(0.08, 0.08, pouchWidth, 16);
    const topRoll = new THREE.Mesh(rollGeometry, leatherMaterial);
    topRoll.rotation.z = Math.PI / 2;
    topRoll.position.set(0, 0.03, -pouchLength / 2);
    pouchMesh.add(topRoll);

    group.add(pouchMesh);

    // 2. Lockpicks
    const steelMaterial = new THREE.MeshStandardMaterial({
        color: 0x88929e,     // Steel gray
        roughness: 0.3,      // Moderately shiny
        metalness: 0.8,      // Very metallic
        envMapIntensity: 1.0 // Reflective
    });

    const brassMaterial = new THREE.MeshStandardMaterial({
        color: 0x8c7853,     // Brass/bronze
        roughness: 0.4,
        metalness: 0.7,
        envMapIntensity: 1.0
    });

    // Create 3 different lockpicks resting on the pouch

    // Pick 1: Hook pick
    const pick1 = createHookPick(steelMaterial, brassMaterial);
    pick1.position.set(-0.2, pouchThickness, 0.2);
    pick1.rotation.y = Math.PI / 12;
    pick1.rotation.x = Math.PI / 2; // Lie flat
    group.add(pick1);

    // Pick 2: Rake pick
    const pick2 = createRakePick(steelMaterial, steelMaterial);
    pick2.position.set(0.1, pouchThickness, 0.1);
    pick2.rotation.y = -Math.PI / 8;
    pick2.rotation.x = Math.PI / 2; // Lie flat
    group.add(pick2);

    // Pick 3: Tension wrench
    const wrench = createTensionWrench(steelMaterial);
    wrench.position.set(0.3, pouchThickness, -0.3);
    wrench.rotation.y = Math.PI / 6;
    wrench.rotation.x = Math.PI / 2; // Lie flat
    group.add(wrench);

    // Position and Rotate the entire group
    group.position.set(position.x, position.y + pouchThickness / 2, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics
    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // Use a simple BoxShape for the entire pouch+picks area
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(pouchWidth / 2, pouchThickness / 2, pouchLength / 2));
        const body = createStaticBody(physicsWorld, group, shape);
        group.userData.body = body;
    }

    return { group };
}

function createHookPick(bladeMat, handleMat) {
    const pick = new THREE.Group();

    // Handle
    const handleGeom = new THREE.BoxGeometry(0.12, 0.8, 0.04);
    const handle = new THREE.Mesh(handleGeom, handleMat);
    handle.position.y = -0.4;
    handle.castShadow = true;
    pick.add(handle);

    // Shaft
    const shaftGeom = new THREE.CylinderGeometry(0.015, 0.02, 0.6, 8);
    const shaft = new THREE.Mesh(shaftGeom, bladeMat);
    shaft.position.y = 0.3;
    shaft.castShadow = true;
    pick.add(shaft);

    // Hook (tip)
    const hookGeom = new THREE.TorusGeometry(0.04, 0.015, 8, 16, Math.PI);
    const hook = new THREE.Mesh(hookGeom, bladeMat);
    hook.position.set(0.04, 0.6, 0);
    hook.rotation.z = Math.PI / 2;
    hook.castShadow = true;
    pick.add(hook);

    return pick;
}

function createRakePick(bladeMat, handleMat) {
    const pick = new THREE.Group();

    // Handle
    const handleGeom = new THREE.BoxGeometry(0.12, 0.8, 0.04);
    const handle = new THREE.Mesh(handleGeom, handleMat);
    handle.position.y = -0.4;
    handle.castShadow = true;
    pick.add(handle);

    // Shaft
    const shaftGeom = new THREE.BoxGeometry(0.03, 0.6, 0.02);
    const shaft = new THREE.Mesh(shaftGeom, bladeMat);
    shaft.position.y = 0.3;
    shaft.castShadow = true;
    pick.add(shaft);

    // Rake tip (using cones for jagged edges)
    for(let i=0; i<3; i++) {
        const bumpGeom = new THREE.ConeGeometry(0.02, 0.06, 8);
        const bump = new THREE.Mesh(bumpGeom, bladeMat);
        bump.position.set(0.015, 0.5 + (i * 0.05), 0);
        bump.rotation.z = -Math.PI / 2;
        bump.castShadow = true;
        pick.add(bump);
    }

    return pick;
}

function createTensionWrench(mat) {
    const wrench = new THREE.Group();

    // Main body
    const bodyGeom = new THREE.BoxGeometry(0.06, 1.0, 0.02);
    const body = new THREE.Mesh(bodyGeom, mat);
    body.position.y = -0.1;
    body.castShadow = true;
    wrench.add(body);

    // Bent tip
    const tipGeom = new THREE.BoxGeometry(0.2, 0.06, 0.02);
    const tip = new THREE.Mesh(tipGeom, mat);
    tip.position.set(0.07, 0.4, 0);
    tip.castShadow = true;
    wrench.add(tip);

    return wrench;
}

/**
 * Generates procedural leather textures
 */
function generateLeatherTextures() {
    const size = 512;

    // --- Diffuse Map ---
    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = size;
    diffCanvas.height = size;
    const diffCtx = diffCanvas.getContext('2d');

    diffCtx.fillStyle = '#4a2e15';
    diffCtx.fillRect(0, 0, size, size);

    // Add noise and discoloration for worn leather
    for (let i = 0; i < 5000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;

        // Darker spots
        if (Math.random() > 0.5) {
            diffCtx.fillStyle = '#3a200a';
            diffCtx.globalAlpha = 0.1;
            diffCtx.beginPath();
            diffCtx.arc(x, y, Math.random() * 5 + 1, 0, Math.PI * 2);
            diffCtx.fill();
        } else {
            // Scratches/lighter spots
            diffCtx.fillStyle = '#5c3a1b';
            diffCtx.globalAlpha = 0.05;
            diffCtx.fillRect(x, y, Math.random() * 20 + 2, 1);
        }
    }

    const diffuseMap = new THREE.CanvasTexture(diffCanvas);
    diffuseMap.colorSpace = THREE.SRGBColorSpace;
    diffuseMap.wrapS = THREE.RepeatWrapping;
    diffuseMap.wrapT = THREE.RepeatWrapping;

    // --- Roughness Map ---
    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const roughCtx = roughCanvas.getContext('2d');

    roughCtx.globalAlpha = 1.0;
    roughCtx.fillStyle = '#cccccc'; // Base roughness (fairly rough)
    roughCtx.fillRect(0, 0, size, size);

    // Add variations to roughness
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        roughCtx.fillStyle = Math.random() > 0.7 ? '#999999' : '#eeeeee';
        roughCtx.globalAlpha = 0.2;
        roughCtx.beginPath();
        roughCtx.arc(x, y, Math.random() * 10 + 2, 0, Math.PI * 2);
        roughCtx.fill();
    }

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;

    // --- Bump Map ---
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bumpCtx = bumpCanvas.getContext('2d');

    bumpCtx.globalAlpha = 1.0;
    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 8000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        bumpCtx.fillStyle = Math.random() > 0.5 ? '#888888' : '#777777';
        bumpCtx.globalAlpha = 0.3;
        bumpCtx.fillRect(x, y, 2, 2);
    }

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.colorSpace = THREE.NoColorSpace;
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;

    return { diffuseMap, roughnessMap, bumpMap };
}
