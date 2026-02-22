import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createCrystalBall(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'CrystalBall';

    // Dimensions
    const ballRadius = 0.5;
    const standHeight = 0.4;
    const standRadiusTop = 0.35;
    const standRadiusBot = 0.4;

    // Materials
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700, // Brighter gold
        roughness: 0.3,
        metalness: 0.8
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.05,
        transmission: 0.9,
        thickness: 1.0,
        ior: 1.5,
        clearcoat: 1.0,
        transparent: true,
        side: THREE.DoubleSide
    });

    // 1. Detailed Stand (Base + Stem + Rim from branch)
    const baseHeight = 0.1;
    const stemHeight = 0.25;
    
    // Base
    const baseGeo = new THREE.CylinderGeometry(standRadiusBot * 0.8, standRadiusBot, baseHeight, 16);
    const baseMesh = new THREE.Mesh(baseGeo, goldMat);
    baseMesh.position.y = baseHeight / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // Stem
    const stemGeo = new THREE.CylinderGeometry(0.1, 0.15, stemHeight, 8);
    const stemMesh = new THREE.Mesh(stemGeo, goldMat);
    stemMesh.position.y = baseHeight + stemHeight / 2;
    stemMesh.castShadow = true;
    stemMesh.receiveShadow = true;
    group.add(stemMesh);

    // Holder Cup (Torus Rim)
    const rimGeo = new THREE.TorusGeometry(standRadiusTop, 0.04, 8, 16);
    const rimMesh = new THREE.Mesh(rimGeo, goldMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = baseHeight + stemHeight;
    group.add(rimMesh);

    // 2. The Crystal Ball
    const ballGeo = new THREE.SphereGeometry(ballRadius, 32, 32);
    const ballMesh = new THREE.Mesh(ballGeo, glassMat);
    // Sit on top of the stand (slightly embedded like in main)
    ballMesh.position.y = baseHeight + stemHeight + ballRadius * 0.7;
    ballMesh.castShadow = true;
    group.add(ballMesh);

    // 3. Magical Glow (Point Light + Inner Core)
    const lightColor = 0xaa00ff; // Mystical purple from branch
    const glowLight = new THREE.PointLight(lightColor, 2.0, 3.0);
    glowLight.position.copy(ballMesh.position);
    glowLight.castShadow = false;
    group.add(glowLight);

    // Inner glowing core (Icosahedron from branch for more interesting shape)
    const coreGeo = new THREE.IcosahedronGeometry(0.15, 0);
    const coreMat = new THREE.MeshStandardMaterial({
        color: 0xff00ff,
        emissive: lightColor,
        emissiveIntensity: 2.0,
        roughness: 0.8,
        transparent: true,
        opacity: 0.8
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.copy(ballMesh.position);
    group.add(coreMesh);

    // Position on Table
    // Table Top is at Y = -2.75
    group.position.set(6, -2.75, -4);

    scene.add(group);

    // Physics - Using main's approach with separate collision shapes for better accuracy
    const ammo = getAmmo();
    if (ammo) {
        // Sphere shape for the ball
        const ballPhysMesh = new THREE.Mesh(
            new THREE.SphereGeometry(ballRadius), 
            new THREE.MeshBasicMaterial({ visible: false })
        );
        ballPhysMesh.position.copy(group.position);
        ballPhysMesh.position.y += ballMesh.position.y;
        scene.add(ballPhysMesh);

        const ballShape = new ammo.btSphereShape(ballRadius);
        createStaticBody(physicsWorld, ballPhysMesh, ballShape);

        // Cylinder shape for the stand base
        const standPhysMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(standRadiusBot, standRadiusBot, baseHeight),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        standPhysMesh.position.copy(group.position);
        standPhysMesh.position.y += baseHeight / 2;
        scene.add(standPhysMesh);

        const standShape = new ammo.btCylinderShape(
            new ammo.btVector3(standRadiusBot, baseHeight / 2, standRadiusBot)
        );
        createStaticBody(physicsWorld, standPhysMesh, standShape);
    }

    return group;
}