import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createSkull(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'SkullProp';

    // Materials
    const boneMat = new THREE.MeshStandardMaterial({
        color: 0xe3dac9, // Bone white/beige
        roughness: 0.7,
        metalness: 0.1
    });

    const socketMat = new THREE.MeshStandardMaterial({
        color: 0x111111, // Dark black
        roughness: 0.9,
        metalness: 0.0
    });

    const glowColor = 0xff0000; // Red glow

    // --- Geometry ---

    // 1. Cranium (Top part)
    const craniumGeo = new THREE.SphereGeometry(0.35, 16, 16);
    // Flatten bottom slightly? Or just let it sink into jaw.
    const cranium = new THREE.Mesh(craniumGeo, boneMat);
    cranium.scale.set(1.0, 1.2, 1.1); // Elongate slightly
    cranium.castShadow = true;
    cranium.receiveShadow = true;
    group.add(cranium);

    // 2. Jaw (Mandible)
    const jawWidth = 0.4;
    const jawHeight = 0.25;
    const jawDepth = 0.4;
    const jawGeo = new THREE.BoxGeometry(jawWidth, jawHeight, jawDepth);
    const jaw = new THREE.Mesh(jawGeo, boneMat);
    // Position below cranium, slightly forward
    jaw.position.set(0, -0.35, 0.1);
    jaw.castShadow = true;
    jaw.receiveShadow = true;
    group.add(jaw);

    // 3. Eye Sockets
    const socketRadius = 0.08;
    const socketGeo = new THREE.CylinderGeometry(socketRadius, socketRadius, 0.1, 16);
    const socketLeft = new THREE.Mesh(socketGeo, socketMat);
    socketLeft.rotation.x = Math.PI / 2;
    socketLeft.position.set(-0.12, -0.05, 0.32); // Front of cranium
    group.add(socketLeft);

    const socketRight = new THREE.Mesh(socketGeo, socketMat);
    socketRight.rotation.x = Math.PI / 2;
    socketRight.position.set(0.12, -0.05, 0.32);
    group.add(socketRight);

    // 4. Nose Cavity (Triangle)
    const noseGeo = new THREE.ConeGeometry(0.06, 0.1, 3); // Triangular prism
    const nose = new THREE.Mesh(noseGeo, socketMat);
    nose.rotation.x = -Math.PI / 2; // Point forward
    nose.scale.z = 0.2; // Flatten
    nose.position.set(0, -0.15, 0.35);
    group.add(nose);

    // 5. Teeth
    const toothGeo = new THREE.BoxGeometry(0.04, 0.06, 0.02);
    const numTeeth = 6;
    const startX = -((numTeeth-1) * 0.05) / 2;

    // Upper Teeth (Attached to Cranium bottom front)
    for(let i=0; i<numTeeth; i++) {
        const tooth = new THREE.Mesh(toothGeo, boneMat);
        tooth.position.set(startX + i * 0.05, -0.28, 0.34);
        group.add(tooth);
    }

    // Lower Teeth (Attached to Jaw top front)
    for(let i=0; i<numTeeth; i++) {
        const tooth = new THREE.Mesh(toothGeo, boneMat);
        tooth.position.set(startX + i * 0.05, -0.32, 0.34); // Slightly lower
        group.add(tooth);
    }

    // --- Glow Effects (Eyes) ---
    // Point Lights inside sockets
    const eyeLightIntensity = 2.0;
    const leftLight = new THREE.PointLight(glowColor, 0, 2); // Start off
    leftLight.position.copy(socketLeft.position);
    leftLight.position.z += 0.05; // Slightly in front
    group.add(leftLight);

    const rightLight = new THREE.PointLight(glowColor, 0, 2);
    rightLight.position.copy(socketRight.position);
    rightLight.position.z += 0.05;
    group.add(rightLight);

    // --- State ---
    let isGlowing = false;

    const toggleGlow = () => {
        isGlowing = !isGlowing;
        const intensity = isGlowing ? eyeLightIntensity : 0;
        leftLight.intensity = intensity;
        rightLight.intensity = intensity;

        // Change socket material emissive to fake glow source
        if (isGlowing) {
            socketMat.emissive.setHex(glowColor);
            socketMat.emissiveIntensity = 0.5;
        } else {
            socketMat.emissive.setHex(0x000000);
            socketMat.emissiveIntensity = 0;
        }
    };

    // --- Positioning ---
    // Place on table. Table Y = -2.75.
    // Skull height ~ 0.8 (Cranium 0.35*2 + Jaw).
    // Center ~ -2.75 + 0.35 = -2.4.
    // Place near books/candle.
    group.position.set(-1.5, -2.4, -3.0);
    // Rotate to look at user
    group.rotation.y = 0.3;

    scene.add(group);

    // --- Physics ---
    if (physicsWorld) {
        const ammo = getAmmo();
        // Sphere shape covers cranium well enough for rolling/static collision
        const shape = new ammo.btSphereShape(0.4);
        createStaticBody(physicsWorld, group, shape);
    }

    return {
        group,
        toggleGlow
    };
}
