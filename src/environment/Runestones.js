import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createRunestones(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Runestones';

    // Dimensions for a single runestone
    const radius = 0.15;
    const height = 0.05;

    // We'll create a handful of hexagonal stones
    const numStones = 5;

    // Define colors for the glowing runes
    const runeColors = [
        '#00ffff', // Cyan
        '#ff00ff', // Magenta
        '#ffff00', // Yellow
        '#00ff00', // Green
        '#ff8800'  // Orange
    ];

    // Base position on the table (Table Y is approx -2.75)
    // Place them off to the side, e.g., near X=3, Z=-5
    const baseX = 3.5;
    const baseZ = -5.5;
    const baseY = -2.75 + height / 2; // Sit exactly on the table

    for (let i = 0; i < numStones; i++) {
        // Procedurally generated texture for the top face
        const runeColor = runeColors[i % runeColors.length];
        const texture = generateRuneTexture(runeColor);

        // Stone material (dark grey, slightly rough)
        const stoneMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.8,
            metalness: 0.1
        });

        // Glowing rune material (for the top face)
        const runeMat = new THREE.MeshStandardMaterial({
            map: texture,
            emissiveMap: texture,
            emissive: new THREE.Color(runeColor),
            emissiveIntensity: 1.5,
            color: 0x333333,
            roughness: 0.6,
            metalness: 0.2
        });

        // CylinderGeometry (radiusTop, radiusBottom, height, radialSegments)
        // 6 segments makes a hexagon
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 6);

        // Cylinder materials array:
        // [0: side, 1: top, 2: bottom]
        const materials = [stoneMat, runeMat, stoneMat];

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Position with some random scatter
        const offsetX = (Math.random() - 0.5) * 1.5;
        const offsetZ = (Math.random() - 0.5) * 1.5;

        // Add a slight stack/overlap offset to avoid z-fighting if they touch
        const yPos = baseY + (i * 0.001);

        mesh.position.set(baseX + offsetX, yPos, baseZ + offsetZ);

        // Randomly rotate around the Y axis
        mesh.rotation.y = Math.random() * Math.PI * 2;

        group.add(mesh);

        // Physics for each runestone
        // btCylinderShape expects a vector of (radius, height/2, radius)
        if (ammo) {
            const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height / 2, radius));
            createStaticBody(physicsWorld, mesh, shape);
        }
    }

    scene.add(group);
    return group;
}

function generateRuneTexture(glowColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Background (dark stone)
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 128, 128);

    // Subtle noise for stone texture
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const c = Math.floor(Math.random() * 30 + 10);
        ctx.fillStyle = `rgb(${c},${c},${c})`;
        ctx.fillRect(x, y, 2, 2);
    }

    // Rune symbol
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    // Draw a random abstract rune (3-4 connected lines)
    // Start somewhere near the center
    let cx = 64 + (Math.random() - 0.5) * 20;
    let cy = 64 + (Math.random() - 0.5) * 20;
    ctx.moveTo(cx, cy);

    const segments = Math.floor(Math.random() * 3) + 3; // 3 to 5 segments
    for (let s = 0; s < segments; s++) {
        // Next point within bounds
        cx += (Math.random() - 0.5) * 60;
        cy += (Math.random() - 0.5) * 60;
        // Keep inside circle
        cx = Math.max(30, Math.min(98, cx));
        cy = Math.max(30, Math.min(98, cy));
        ctx.lineTo(cx, cy);
    }

    // Outer glow
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Solid inner line
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff'; // White hot core
    ctx.lineWidth = 2;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
