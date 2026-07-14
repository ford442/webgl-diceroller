import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createSpectacles(scene, physicsWorld, position = { x: 6, y: -2.75, z: -4 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'Spectacles';

    // Enhanced Materials
    // 1. Gold/Brass for the frames
    const frameMat = new THREE.MeshStandardMaterial({
        color: 0xc5a059, // Gold/Brass
        metalness: 0.9,
        roughness: 0.2,
        envMapIntensity: 1.2
    });

    // 2. Glass for the lenses
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.05,
        transmission: 0.9, // high transmission for clear glass
        ior: 1.5,
        thickness: 0.02,
        transparent: true,
        envMapIntensity: 1.5
    });

    // Dimensions
    const lensRadius = 0.2;
    const lensThick = 0.01;
    const frameTube = 0.015;
    const bridgeWidth = 0.15;

    // --- Lenses and Frames ---

    // Left Lens & Frame
    const leftGroup = new THREE.Group();

    const lensGeo = new THREE.CylinderGeometry(lensRadius, lensRadius, lensThick, 32);
    const leftLens = new THREE.Mesh(lensGeo, glassMat);
    leftLens.rotation.x = Math.PI / 2; // Face forward (+Z)
    leftGroup.add(leftLens);

    const frameGeo = new THREE.TorusGeometry(lensRadius + frameTube/2, frameTube, 16, 32);
    const leftFrame = new THREE.Mesh(frameGeo, frameMat);
    leftFrame.castShadow = true;
    leftFrame.receiveShadow = true;
    leftGroup.add(leftFrame);

    leftGroup.position.set(-lensRadius - bridgeWidth/2, 0, 0);
    group.add(leftGroup);

    // Right Lens & Frame
    const rightGroup = new THREE.Group();

    const rightLens = new THREE.Mesh(lensGeo, glassMat);
    rightLens.rotation.x = Math.PI / 2;
    rightGroup.add(rightLens);

    const rightFrame = new THREE.Mesh(frameGeo, frameMat);
    rightFrame.castShadow = true;
    rightFrame.receiveShadow = true;
    rightGroup.add(rightFrame);

    rightGroup.position.set(lensRadius + bridgeWidth/2, 0, 0);
    group.add(rightGroup);

    // --- Bridge ---
    // A simple curved tube connecting the two lenses
    const bridgeCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-bridgeWidth/2, 0, 0),
        new THREE.Vector3(0, 0.05, 0.05), // Curve up and slightly forward
        new THREE.Vector3(bridgeWidth/2, 0, 0)
    );
    const bridgeGeo = new THREE.TubeGeometry(bridgeCurve, 8, frameTube, 8, false);
    const bridgeMesh = new THREE.Mesh(bridgeGeo, frameMat);
    bridgeMesh.castShadow = true;
    bridgeMesh.receiveShadow = true;
    group.add(bridgeMesh);

    // --- Arms (Temples) ---
    // Folded glasses: Arms fold inward behind the lenses.
    const armLen = 0.5;
    const armCurveGeo = new THREE.CylinderGeometry(frameTube, frameTube, armLen, 8);

    // Left Arm (Folded behind)
    const leftArm = new THREE.Mesh(armCurveGeo, frameMat);
    leftArm.rotation.x = Math.PI / 2; // Lay flat
    leftArm.rotation.z = Math.PI / 2 - 0.2; // Angle inward
    // Position starts from outer edge of left lens, extending rightwards and backwards
    leftArm.position.set(-lensRadius * 1.5, 0, -armLen/2 + 0.05);
    leftArm.castShadow = true;
    leftArm.receiveShadow = true;
    group.add(leftArm);

    // Right Arm (Folded behind, crossing over or under)
    const rightArm = new THREE.Mesh(armCurveGeo, frameMat);
    rightArm.rotation.x = Math.PI / 2;
    rightArm.rotation.z = -Math.PI / 2 + 0.2;
    rightArm.position.set(lensRadius * 1.5, -0.02, -armLen/2 + 0.05); // slightly lower to avoid z-fighting
    rightArm.castShadow = true;
    rightArm.receiveShadow = true;
    group.add(rightArm);

    // Earpieces (Curved ends)
    const earpieceGeo = new THREE.TorusGeometry(0.05, frameTube, 8, 16, Math.PI);

    const leftEar = new THREE.Mesh(earpieceGeo, frameMat);
    leftEar.rotation.x = Math.PI / 2;
    // position at the end of the arm
    leftEar.position.set(-lensRadius * 1.5 + (armLen/2) * Math.cos(0.2), 0, -armLen + 0.05);
    leftEar.castShadow = true;
    group.add(leftEar);

    const rightEar = new THREE.Mesh(earpieceGeo, frameMat);
    rightEar.rotation.x = Math.PI / 2;
    rightEar.rotation.y = Math.PI; // flip
    rightEar.position.set(lensRadius * 1.5 - (armLen/2) * Math.cos(0.2), -0.02, -armLen + 0.05);
    rightEar.castShadow = true;
    group.add(rightEar);

    // --- Positioning ---
    // Table top is roughly Y = -2.75.
    // The frames lay flat, so rotate X by -90 degrees.
    group.rotation.x = -Math.PI / 2;
    // Also add rotation around the vertical axis
    group.rotation.order = 'YXZ';
    group.rotation.y = rotationY;

    // To sit flush on the table, we need to account for the frame thickness.
    const restingHeight = frameTube; // roughly
    group.position.set(position.x, position.y + restingHeight, position.z);

    scene.add(group);

    // --- Physics ---
    // A simple static box body to cover the resting spectacles.
    // Total width is roughly 2 * lensRadius + bridgeWidth + 2 * frameTube.
    // Height (when laying flat) is just the frame thickness/arm thickness, so ~0.05.
    // Depth is the lens diameter, ~ 2 * lensRadius.
    const ammo = getAmmo();
    if (ammo) {
        if (ammo && physicsWorld) {
            const shape = new ammo.btBoxShape(new ammo.btVector3(
                (lensRadius * 2 + bridgeWidth) / 2 + 0.1,
                0.05 / 2,
                (lensRadius * 2) / 2 + 0.1
            ));
            createStaticBody(physicsWorld, group, shape);
        }
    }
}
