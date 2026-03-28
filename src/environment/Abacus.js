import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createAbacus(scene, physicsWorld, position = { x: -3, y: -2.75, z: 2 }, rotationY = Math.PI / 4) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    group.name = 'Abacus';

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x4a2e15, // Dark reddish brown wood
        roughness: 0.7,
        metalness: 0.1
    });

    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass rails
        metalness: 0.9,
        roughness: 0.3,
        envMapIntensity: 1.2
    });

    const beadMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37, // Gold/Brass beads
        metalness: 0.8,
        roughness: 0.4,
        envMapIntensity: 1.0
    });

    // Dimensions
    const frameWidth = 4.0;
    const frameHeight = 2.0;
    const frameThickness = 0.2;
    const railCount = 5;
    const beadCountPerRail = 10;
    const railRadius = 0.03;
    const beadOuterRadius = 0.15;
    const beadInnerRadius = 0.05; // Torus tube
    const railSpacing = (frameWidth - 0.4) / (railCount - 1);

    // Frame Top/Bottom
    const topBotGeo = new THREE.BoxGeometry(frameWidth, frameThickness, frameThickness);
    const topFrame = new THREE.Mesh(topBotGeo, woodMat);
    topFrame.position.y = frameHeight / 2 - frameThickness / 2;
    topFrame.castShadow = true;
    topFrame.receiveShadow = true;
    group.add(topFrame);

    const botFrame = new THREE.Mesh(topBotGeo, woodMat);
    botFrame.position.y = -(frameHeight / 2 - frameThickness / 2);
    botFrame.castShadow = true;
    botFrame.receiveShadow = true;
    group.add(botFrame);

    // Frame Left/Right
    const sideGeo = new THREE.BoxGeometry(frameThickness, frameHeight, frameThickness);
    const leftFrame = new THREE.Mesh(sideGeo, woodMat);
    leftFrame.position.x = -(frameWidth / 2 - frameThickness / 2);
    leftFrame.castShadow = true;
    leftFrame.receiveShadow = true;
    group.add(leftFrame);

    const rightFrame = new THREE.Mesh(sideGeo, woodMat);
    rightFrame.position.x = frameWidth / 2 - frameThickness / 2;
    rightFrame.castShadow = true;
    rightFrame.receiveShadow = true;
    group.add(rightFrame);

    // Rails and Beads
    const railGeo = new THREE.CylinderGeometry(railRadius, railRadius, frameHeight - frameThickness * 2, 8);
    const beadGeo = new THREE.TorusGeometry(beadOuterRadius, beadInnerRadius, 8, 16);

    for (let i = 0; i < railCount; i++) {
        const railX = -(frameWidth / 2) + 0.2 + i * railSpacing;

        // Rail
        const railMesh = new THREE.Mesh(railGeo, brassMat);
        railMesh.position.x = railX;
        railMesh.castShadow = true;
        group.add(railMesh);

        // Beads
        // Beads are positioned randomly along the rail
        const railLength = frameHeight - frameThickness * 2;
        const availableSpace = railLength - (beadOuterRadius * 2 * beadCountPerRail);
        let currentY = -(railLength / 2) + beadOuterRadius;

        for (let j = 0; j < beadCountPerRail; j++) {
            const beadMesh = new THREE.Mesh(beadGeo, beadMat);

            // Add a little randomness to spacing
            const extraSpace = (Math.random() * availableSpace) / beadCountPerRail;
            currentY += extraSpace;

            beadMesh.position.set(railX, currentY, 0);
            beadMesh.rotation.x = Math.PI / 2; // Lie flat around rail

            // Randomly tilt beads slightly
            beadMesh.rotation.y = (Math.random() - 0.5) * 0.2;
            beadMesh.rotation.z = (Math.random() - 0.5) * 0.2;

            beadMesh.castShadow = true;
            group.add(beadMesh);

            currentY += beadOuterRadius * 2;
        }
    }

    // Lie the abacus flat on the table
    // It's currently built standing up in XY plane
    // We want it lying flat in XZ plane
    // Y becomes Z, Z becomes -Y
    group.rotation.set(-Math.PI / 2, rotationY, 0, 'YXZ');
    // Group Y should be adjusted so it rests on the table
    // Frame thickness is 0.2, so center is 0.1 above table
    group.position.y = position.y + frameThickness / 2;

    scene.add(group);

    // Physics
    if (physicsWorld) {
        // Simple bounding box for the whole abacus
        const shape = new ammo.btBoxShape(new ammo.btVector3(frameWidth / 2, frameHeight / 2, frameThickness / 2));

        // createStaticBody uses group.position and group.quaternion
        // Wait, the bounding box was built assuming the abacus is standing up.
        // btBoxShape dimensions match the visual dimensions before the group rotation.
        // Because the physics body uses the group's quaternion, it will rotate the box.
        // So the dimensions (frameWidth/2, frameHeight/2, frameThickness/2) correspond to X, Y, Z.
        // This is correct since we applied the rotation to the group.
        createStaticBody(physicsWorld, group, shape);
    }

    return {
        group
    };
}
