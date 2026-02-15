import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createCrystalBall(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'CrystalBall';

    // Dimensions
    const ballRadius = 0.6;
    const standHeight = 0.4;
    const standRadiusTop = 0.4;
    const standRadiusBot = 0.5;

    // Materials
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37, // Gold
        metalness: 1.0,
        roughness: 0.3
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.05,
        transmission: 0.95, // High transparency
        thickness: 1.0, // Volume rendering
        ior: 1.5, // Glass IOR
        clearcoat: 1.0,
        transparent: true,
        side: THREE.DoubleSide
    });

    // 1. The Stand
    const standGeo = new THREE.CylinderGeometry(standRadiusTop, standRadiusBot, standHeight, 16);
    const standMesh = new THREE.Mesh(standGeo, goldMat);
    standMesh.position.y = standHeight / 2;
    standMesh.castShadow = true;
    standMesh.receiveShadow = true;
    group.add(standMesh);

    // Decorative Ring on stand
    const ringGeo = new THREE.TorusGeometry(standRadiusTop + 0.05, 0.05, 8, 16);
    const ringMesh = new THREE.Mesh(ringGeo, goldMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = standHeight - 0.05;
    group.add(ringMesh);

    // 2. The Crystal Ball
    const ballGeo = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMesh = new THREE.Mesh(ballGeo, glassMat);
    // Sit on top of the stand (slightly embedded)
    ballMesh.position.y = standHeight + ballRadius * 0.7;
    ballMesh.castShadow = true; // Glass casts shadow (caustics are hard, but shadow is fine)
    // ballMesh.receiveShadow = true; // Avoid self-shadowing artifacts on glass sometimes
    group.add(ballMesh);

    // 3. Magical Glow (Inner Light)
    const lightColor = 0x8844ff; // Mystical Purple
    const light = new THREE.PointLight(lightColor, 2, 5);
    light.position.copy(ballMesh.position);
    group.add(light);

    // Inner glowing core (visual only)
    const coreGeo = new THREE.SphereGeometry(ballRadius * 0.3, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: lightColor });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.copy(ballMesh.position);
    group.add(coreMesh);


    // Position on Table
    // Table Top is at Y = -2.75
    // We position the group at table level
    group.position.set(6, -2.75, -4);

    scene.add(group);

    // Physics
    // Use a simple Sphere shape for the ball and stand combined?
    // Or a Cylinder for the stand and Sphere for the ball?
    // Let's use a Sphere shape that covers the ball, as that's what dice will hit most likely.
    // Center of mass for physics shape relative to group origin:
    // Ball center is at y = standHeight + ballRadius*0.7 ~ 0.4 + 0.42 = 0.82.
    // If we make a sphere shape there, createStaticBody expects mesh position to be origin of body?
    // createStaticBody uses group.position.
    // Shape offset needs to be handled if we want precise collision.
    // But createStaticBody (in physics.js) centers shape at group origin.
    // So if we use a SphereShape, it will be at group origin (0,0,0) which is the bottom of the stand.
    // The ball is high up.

    // We need to offset the shape or use a Compound Shape (which createsStaticBody doesn't support easily without custom code).
    // OR we can create an invisible mesh for physics that is positioned correctly.

    // Let's create an invisible physics mesh that matches the ball position.
    const physMesh = new THREE.Mesh(new THREE.SphereGeometry(ballRadius), new THREE.MeshBasicMaterial({ visible: false }));
    // Position it in World Space where the ball is.
    physMesh.position.copy(group.position);
    physMesh.position.y += ballMesh.position.y;
    scene.add(physMesh);

    const ammo = getAmmo();
    if (ammo) {
        const shape = new ammo.btSphereShape(ballRadius);
        createStaticBody(physicsWorld, physMesh, shape);

        // Also add a cylinder for the stand?
        const standPhysMesh = new THREE.Mesh(new THREE.CylinderGeometry(standRadiusBot, standRadiusBot, standHeight), new THREE.MeshBasicMaterial({ visible: false }));
        standPhysMesh.position.copy(group.position);
        standPhysMesh.position.y += standHeight / 2;
        scene.add(standPhysMesh);

        const standShape = new ammo.btCylinderShape(new ammo.btVector3(standRadiusBot, standHeight/2, standRadiusBot));
        createStaticBody(physicsWorld, standPhysMesh, standShape);
    }

    return group;
}
