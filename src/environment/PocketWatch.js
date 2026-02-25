import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createPocketWatch(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'PocketWatch';

    // Materials
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        metalness: 1.0
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0,
        transmission: 0.9,
        transparent: true,
        thickness: 0.1
    });

    const faceTexture = generateWatchFaceTexture();
    const faceMat = new THREE.MeshStandardMaterial({
        map: faceTexture,
        roughness: 0.5,
        metalness: 0.1
    });

    const handsMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.8
    });

    // --- Case ---
    const radius = 0.6;
    const thickness = 0.2;
    const caseGeo = new THREE.CylinderGeometry(radius, radius, thickness, 32);
    const caseMesh = new THREE.Mesh(caseGeo, goldMat);
    caseMesh.castShadow = true;
    caseMesh.receiveShadow = true;
    group.add(caseMesh);

    // --- Face ---
    const faceRadius = radius - 0.05;
    const faceGeo = new THREE.CircleGeometry(faceRadius, 32);
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.rotation.x = -Math.PI / 2;
    faceMesh.position.y = thickness / 2 + 0.001;
    group.add(faceMesh);

    // --- Hands ---
    // Hour Hand (e.g., at 10)
    const hourHandGeo = new THREE.BoxGeometry(0.04, 0.01, 0.3);
    const hourHand = new THREE.Mesh(hourHandGeo, handsMat);
    hourHand.position.y = thickness / 2 + 0.02;
    // Rotate to 10 o'clock (approx -60 degrees)
    hourHand.rotation.y = -Math.PI / 3;
    // Offset so pivot is at one end (approx)
    hourHand.position.x = -0.1 * Math.sin(-Math.PI/3);
    hourHand.position.z = -0.1 * Math.cos(-Math.PI/3);
    // Actually geometry translation is easier for pivot
    // Let's reset pos and use geometry translation or pivot group.
    // Simple way: Geometry translation
    // But sharing geometry means we can't translate it differently for others.
    // BoxGeometry is created unique here.
    hourHandGeo.translate(0, 0, 0.1); // Pivot at one end
    // Re-position mesh at center
    hourHand.position.set(0, thickness / 2 + 0.02, 0);
    group.add(hourHand);

    // Minute Hand (e.g., at 10)
    const minHandGeo = new THREE.BoxGeometry(0.03, 0.01, 0.45);
    minHandGeo.translate(0, 0, 0.15);
    const minHand = new THREE.Mesh(minHandGeo, handsMat);
    minHand.position.set(0, thickness / 2 + 0.03, 0);
    // Rotate to 10 minutes (approx +60 degrees)
    minHand.rotation.y = Math.PI / 3;
    group.add(minHand);

    // Center Pin
    const pinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8);
    const pinMesh = new THREE.Mesh(pinGeo, goldMat);
    pinMesh.position.y = thickness / 2 + 0.04;
    group.add(pinMesh);

    // --- Glass Cover ---
    const glassGeo = new THREE.CylinderGeometry(radius - 0.02, radius - 0.02, 0.05, 32);
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.y = thickness / 2 + 0.05;
    glassMesh.castShadow = true;
    glassMesh.receiveShadow = true;
    group.add(glassMesh);

    // --- Stem / Knob ---
    const knobGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16);
    const knobMesh = new THREE.Mesh(knobGeo, goldMat);
    // Position at 12 o'clock (Z-)
    knobMesh.rotation.x = Math.PI / 2;
    knobMesh.position.z = -radius - 0.05;
    group.add(knobMesh);

    // Ring (Torus)
    const ringGeo = new THREE.TorusGeometry(0.15, 0.02, 8, 16);
    const ringMesh = new THREE.Mesh(ringGeo, goldMat);
    ringMesh.position.z = -radius - 0.2;
    // Rotate to stand up relative to watch
    ringMesh.rotation.y = Math.PI / 2;
    group.add(ringMesh);

    // --- Lid (Open) ---
    // Hinge point at Z- (near knob)
    // Create a pivot group for the lid
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, thickness/2, -radius);
    group.add(lidPivot);

    const lidGeo = new THREE.CylinderGeometry(radius, radius, 0.05, 32);
    const lidMesh = new THREE.Mesh(lidGeo, goldMat);
    // Attach lid mesh to pivot, offset so edge is at pivot
    // Center of lid is at (0,0,0) relative to mesh.
    // If pivot is at edge of watch (-radius), we want lid edge to be at pivot.
    // Lid center should be at +radius (Z) relative to pivot?
    // If lid is closed, center is at (0, 0, radius) relative to pivot?
    // Pivot is at -0.6. Watch center 0. Lid center 0.
    // Distance 0.6.
    // So lidMesh local position should be (0, 0, radius).
    lidMesh.position.set(0, 0, radius);
    lidPivot.add(lidMesh);

    // Rotate pivot to open
    lidPivot.rotation.x = -Math.PI / 1.5; // Open back

    // --- Position on Table ---
    // Table Top Y = -2.75.
    // Watch Thickness 0.2. Center Y = -2.75 + 0.1 = -2.65.
    group.position.set(3, -2.65, 2);
    // Random rotation
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // --- Physics ---
    // Simple cylinder shape
    if (ammo) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, thickness / 2, radius));
        createStaticBody(physicsWorld, group, shape);
    }
}

function generateWatchFaceTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);

    // Border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(256, 256, 250, 0, Math.PI * 2);
    ctx.stroke();

    // Ticks & Numbers
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const radius = 200;

    for (let i = 1; i <= 12; i++) {
        // Angle: 12 is at -PI/2.
        // i=12 -> -PI/2. i=3 -> 0.
        // angle = (i-3) * (2PI/12)
        const angle = (i - 3) * (Math.PI * 2) / 12;
        const x = 256 + Math.cos(angle) * radius;
        const y = 256 + Math.sin(angle) * radius;

        ctx.font = 'bold 40px serif';
        const roman = convertToRoman(i);

        // Rotate text? No, upright is fine for pocket watch usually, or radial.
        // Let's keep upright.
        ctx.fillText(roman, x, y);

        // Tick marks
        // ctx.beginPath();
        // ctx.moveTo(256 + Math.cos(angle)*240, 256 + Math.sin(angle)*240);
        // ctx.lineTo(256 + Math.cos(angle)*250, 256 + Math.sin(angle)*250);
        // ctx.stroke();
    }

    // Brand Name
    ctx.font = 'italic 30px serif';
    ctx.fillText('Chronos', 256, 350); // Bottom half

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function convertToRoman(num) {
    const lookup = {M:1000,CM:900,D:500,CD:400,C:100,XC:90,L:50,XL:40,X:10,IX:9,V:5,IV:4,I:1};
    let roman = '';
    for (let i in lookup) {
        while (num >= lookup[i]) {
            roman += i;
            num -= lookup[i];
        }
    }
    return roman;
}
