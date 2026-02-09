import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createMap(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'WorldMap';

    // Map Dimensions
    const width = 10;
    const depth = 7;
    const thickness = 0.05; // Slightly thicker than paper for visibility

    // --- Texture Generation ---
    const texture = generateMapTexture();

    // --- Material ---
    const mapMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    // --- Mesh ---
    const geometry = new THREE.BoxGeometry(width, thickness, depth);
    const mesh = new THREE.Mesh(geometry, mapMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // --- Weights (to hold it down) ---
    const weightGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16);
    const weightMat = new THREE.MeshStandardMaterial({
        color: 0x333333, // Dark stone/metal
        roughness: 0.6,
        metalness: 0.5
    });

    const weightPositions = [
        { x: -width/2 + 0.5, z: -depth/2 + 0.5 },
        { x: width/2 - 0.5, z: -depth/2 + 0.5 },
        { x: -width/2 + 0.5, z: depth/2 - 0.5 },
        { x: width/2 - 0.5, z: depth/2 - 0.5 }
    ];

    weightPositions.forEach(pos => {
        const weight = new THREE.Mesh(weightGeo, weightMat);
        weight.position.set(pos.x, thickness/2 + 0.2, pos.z);
        weight.castShadow = true;
        weight.receiveShadow = true;
        group.add(weight);
    });

    // --- Position on Table ---
    // Table surface is at Y = -2.75.
    // Map center Y = -2.75 + thickness/2 = -2.725.
    const posY = -2.75 + thickness/2;
    group.position.set(-8, posY, 2);
    // Slight random rotation
    group.rotation.y = Math.random() * 0.2 - 0.1;

    scene.add(group);

    // --- Physics ---
    // Map Body
    const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, thickness/2, depth/2));
    createStaticBody(physicsWorld, group, shape);

    // Weights Physics (Approximation: integrated into static map body? Or separate?)
    // Since it's static, we can just let dice collide with the map surface.
    // Ideally, weights should have their own shapes added to a compound shape,
    // but createStaticBody currently takes a single shape.
    // For simplicity, we'll skip physics for the small weights (dice will just roll through them or bounce off map).
    // Or, we can create separate static bodies for them if needed.
    // Let's create separate static bodies for weights to be safe.

    weightPositions.forEach(pos => {
        const wShape = new ammo.btCylinderShape(new ammo.btVector3(0.3, 0.2, 0.3)); // Height 0.4 / 2 = 0.2
        // We need to transform the local position to world position for createStaticBody if we pass a mesh.
        // But createStaticBody uses mesh.position/quaternion.
        // The weights are children of 'group'.
        // So their world position depends on group.

        // Option: Make weights separate objects in scene? No, keep hierarchy clean.
        // Option: Add child shapes to compound shape? Yes, that's better.
        // But createStaticBody is simple.

        // Let's just create individual invisible physics bodies for weights at world coords.
        // We can use a dummy object for position calculation.

        const dummy = new THREE.Object3D();
        dummy.position.copy(group.position).add(new THREE.Vector3(pos.x, thickness/2 + 0.2, pos.z).applyEuler(group.rotation));
        dummy.quaternion.copy(group.quaternion);

        // Since createStaticBody expects a mesh (with .position and .quaternion), dummy works.
        createStaticBody(physicsWorld, dummy, wShape);
    });
}

function generateMapTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');

    // 1. Background (Parchment)
    ctx.fillStyle = '#e3d2b4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Grid Lines (Faint)
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    const gridSize = 64;
    for(let x=0; x<canvas.width; x+=gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for(let y=0; y<canvas.height; y+=gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // 3. Coastline (Blue water on one side)
    ctx.fillStyle = '#aaddff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(300, 0);
    // Wiggly line down
    for(let y=0; y<=canvas.height; y+=20) {
        const x = 300 + Math.sin(y * 0.01) * 50 + Math.random() * 20;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(0, canvas.height);
    ctx.fill();

    // 4. Mountains (Triangles)
    ctx.fillStyle = '#8b4513';
    for(let i=0; i<20; i++) {
        const x = 400 + Math.random() * 400;
        const y = 100 + Math.random() * 200;
        const s = 30 + Math.random() * 30;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + s/2, y - s);
        ctx.lineTo(x + s, y);
        ctx.fill();
    }

    // 5. Forest (Green Circles)
    ctx.fillStyle = '#228b22';
    for(let i=0; i<50; i++) {
        const x = 600 + Math.random() * 300;
        const y = 400 + Math.random() * 300;
        const r = 10 + Math.random() * 10;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // 6. River (Blue Line)
    ctx.strokeStyle = '#0000ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(500, 200); // Start near mountains
    // Wiggle to sea
    let cx = 500;
    let cy = 200;
    while(cx > 300) {
        cx -= 10;
        cy += (Math.random() - 0.3) * 20;
        ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // 7. Text Labels
    ctx.fillStyle = '#4b0082';
    ctx.font = 'bold 40px serif';
    ctx.fillText('Kingdom of Aethelgard', 400, 80);

    ctx.font = 'italic 24px serif';
    ctx.fillText('The Whispering Woods', 650, 600);
    ctx.fillText('Dragon\'s Teeth', 500, 150);

    // 8. Red X (Treasure)
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 8;
    const tx = 750;
    const ty = 500;
    ctx.beginPath();
    ctx.moveTo(tx - 20, ty - 20);
    ctx.lineTo(tx + 20, ty + 20);
    ctx.moveTo(tx + 20, ty - 20);
    ctx.lineTo(tx - 20, ty + 20);
    ctx.stroke();

    ctx.fillStyle = '#ff0000';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Dig Here', tx - 30, ty + 40);

    // 9. Compass Rose
    const compassX = 900;
    const compassY = 100;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(compassX, compassY - 40);
    ctx.lineTo(compassX, compassY + 40);
    ctx.moveTo(compassX - 30, compassY);
    ctx.lineTo(compassX + 30, compassY);
    ctx.stroke();
    ctx.fillText('N', compassX - 10, compassY - 50);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
