import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createCompass(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Compass';

    // Materials
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass
        metalness: 1.0,
        roughness: 0.2
    });

    const faceMat = new THREE.MeshStandardMaterial({
        color: 0xfffdd0, // Cream color for compass face
        roughness: 0.8,
        metalness: 0.0
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.0,
        transmission: 0.9,
        transparent: true,
        ior: 1.5,
        thickness: 0.05
    });

    const needleMatRed = new THREE.MeshStandardMaterial({
        color: 0xcc0000,
        metalness: 0.5,
        roughness: 0.4
    });

    const needleMatSilver = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.8,
        roughness: 0.4
    });

    // 1. Compass Case (Main Body)
    const radius = 0.6;
    const height = 0.2;
    const caseGeo = new THREE.CylinderGeometry(radius, radius, height, 32);
    const caseMesh = new THREE.Mesh(caseGeo, brassMat);
    caseMesh.castShadow = true;
    caseMesh.receiveShadow = true;
    group.add(caseMesh);

    // 2. Inner cavity (Subtracted visually by adding the face slightly lower than the rim)
    const innerRadius = radius - 0.05;
    const faceGeo = new THREE.CylinderGeometry(innerRadius, innerRadius, 0.02, 32);
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.position.y = 0.05; // Slightly below the top rim
    faceMesh.receiveShadow = true;

    // Add compass markings texture procedurally
    const faceTexture = generateCompassFaceTexture();
    faceMat.map = faceTexture;

    group.add(faceMesh);

    // 3. Compass Needle
    const needleGroup = new THREE.Group();
    needleGroup.position.y = 0.07; // Above the face

    // North Needle (Red)
    const nNeedleGeo = new THREE.ConeGeometry(0.04, 0.4, 4);
    const nNeedleMesh = new THREE.Mesh(nNeedleGeo, needleMatRed);
    // Align cone to point along X axis to lie flat
    nNeedleMesh.rotation.x = -Math.PI / 2;
    nNeedleMesh.position.z = -0.2; // Move forward so base is at center
    needleGroup.add(nNeedleMesh);

    // South Needle (Silver)
    const sNeedleGeo = new THREE.ConeGeometry(0.04, 0.4, 4);
    const sNeedleMesh = new THREE.Mesh(sNeedleGeo, needleMatSilver);
    sNeedleMesh.rotation.x = Math.PI / 2;
    sNeedleMesh.position.z = 0.2;
    needleGroup.add(sNeedleMesh);

    // Center Pin
    const pinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8);
    const pinMesh = new THREE.Mesh(pinGeo, brassMat);
    // No rotation needed for vertical cylinder pin
    needleGroup.add(pinMesh);

    // Rotate needle randomly
    needleGroup.rotation.y = Math.random() * Math.PI * 2;
    group.add(needleGroup);

    // 4. Glass Cover
    const glassGeo = new THREE.CylinderGeometry(innerRadius, innerRadius, 0.02, 32);
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.y = height / 2 - 0.01; // Just below the top rim
    group.add(glassMesh);

    // 5. Lid Hinge and Ring
    const hingeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.15);
    const hingeMesh = new THREE.Mesh(hingeGeo, brassMat);
    hingeMesh.position.set(0, 0, radius + 0.02);
    hingeMesh.castShadow = true;
    group.add(hingeMesh);

    const ringGeo = new THREE.TorusGeometry(0.08, 0.02, 8, 16);
    const ringMesh = new THREE.Mesh(ringGeo, brassMat);
    ringMesh.position.set(0, 0, radius + 0.12);
    ringMesh.rotation.y = Math.PI / 2;
    ringMesh.castShadow = true;
    group.add(ringMesh);

    // Position on table
    // Table Top is around -2.75. Center Y = -2.75 + height/2 = -2.65
    group.position.set(4, -2.65, 3);
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    // Simple cylinder collision shape for the compass
    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height/2, radius));
    createStaticBody(physicsWorld, group, shape);

    return group;
}

function generateCompassFaceTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const center = 128;

    // Background
    ctx.fillStyle = '#fffdd0';
    ctx.fillRect(0, 0, 256, 256);

    // Outer Ring
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center, center, 120, 0, Math.PI * 2);
    ctx.stroke();

    // Direction markers
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const directions = [
        { label: 'N', angle: 0 },
        { label: 'E', angle: Math.PI / 2 },
        { label: 'S', angle: Math.PI },
        { label: 'W', angle: Math.PI * 1.5 }
    ];

    directions.forEach(dir => {
        const x = center + Math.sin(dir.angle) * 90;
        const y = center - Math.cos(dir.angle) * 90;
        ctx.fillText(dir.label, x, y);
    });

    // Tick marks
    for (let i = 0; i < 360; i += 15) {
        const rad = (i * Math.PI) / 180;
        const innerRad = i % 90 === 0 ? 105 : 112;
        const x1 = center + Math.sin(rad) * innerRad;
        const y1 = center - Math.cos(rad) * innerRad;
        const x2 = center + Math.sin(rad) * 120;
        const y2 = center - Math.cos(rad) * 120;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = i % 90 === 0 ? 3 : 1;
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
