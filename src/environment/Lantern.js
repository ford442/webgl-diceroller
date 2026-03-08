import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { registerInteractiveObject } from '../interaction.js';

export function createLantern(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Lantern';

    // Materials
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, // Dark wrought iron
        roughness: 0.8,
        metalness: 0.9
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.1,
        transmission: 0.9,
        transparent: true,
        ior: 1.5,
        thickness: 0.05
    });

    const candleMat = new THREE.MeshStandardMaterial({
        color: 0xffffdd, // Wax color
        roughness: 0.6
    });

    // --- Geometries ---

    // 1. Base
    const baseHeight = 0.2;
    const baseRadius = 0.4;
    const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius + 0.1, baseHeight, 8);
    const baseMesh = new THREE.Mesh(baseGeo, metalMat);
    baseMesh.position.y = baseHeight / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Glass Body
    const bodyHeight = 0.8;
    const bodyRadiusBot = 0.35;
    const bodyRadiusTop = 0.4;
    const bodyGeo = new THREE.CylinderGeometry(bodyRadiusTop, bodyRadiusBot, bodyHeight, 8);
    const bodyMesh = new THREE.Mesh(bodyGeo, glassMat);
    bodyMesh.position.y = baseHeight + bodyHeight / 2;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // 3. Top Cap
    const capHeight = 0.25;
    const capGeo = new THREE.CylinderGeometry(0.2, bodyRadiusTop + 0.05, capHeight, 8);
    const capMesh = new THREE.Mesh(capGeo, metalMat);
    capMesh.position.y = baseHeight + bodyHeight + capHeight / 2;
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    group.add(capMesh);

    // 4. Chimney/Vent
    const ventHeight = 0.15;
    const ventGeo = new THREE.CylinderGeometry(0.1, 0.2, ventHeight, 8);
    const ventMesh = new THREE.Mesh(ventGeo, metalMat);
    ventMesh.position.y = baseHeight + bodyHeight + capHeight + ventHeight / 2;
    ventMesh.castShadow = true;
    ventMesh.receiveShadow = true;
    group.add(ventMesh);

    // 5. Handle (Torus)
    const handleGeo = new THREE.TorusGeometry(0.25, 0.03, 8, 16);
    const handleMesh = new THREE.Mesh(handleGeo, metalMat);
    handleMesh.position.y = baseHeight + bodyHeight + capHeight + ventHeight + 0.15;
    handleMesh.castShadow = true;
    group.add(handleMesh);

    // 6. Support Bars (Vertical)
    const barGeo = new THREE.CylinderGeometry(0.02, 0.02, bodyHeight, 4);
    for (let i = 0; i < 4; i++) {
        const barMesh = new THREE.Mesh(barGeo, metalMat);
        const angle = (Math.PI / 2) * i + Math.PI / 4;
        barMesh.position.set(
            Math.cos(angle) * (bodyRadiusTop + 0.02),
            baseHeight + bodyHeight / 2,
            Math.sin(angle) * (bodyRadiusTop + 0.02)
        );
        barMesh.castShadow = true;
        group.add(barMesh);
    }

    // 7. Internal Candle
    const candleRadius = 0.15;
    const candleHeight = 0.4;
    const candleMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(candleRadius, candleRadius, candleHeight, 16),
        candleMat
    );
    candleMesh.position.y = baseHeight + candleHeight / 2;
    candleMesh.castShadow = true;
    group.add(candleMesh);

    // 8. Light Source
    const light = new THREE.PointLight(0xffa500, 1.5, 10);
    // Position light slightly above candle
    light.position.y = baseHeight + candleHeight + 0.1;
    light.castShadow = true;
    light.shadow.bias = -0.001;
    group.add(light);

    // Interactive Toggle
    let isOn = true;
    const toggleLight = () => {
        isOn = !isOn;
        // Tween intensity for smooth transition could be added here,
        // but simple toggle is fine for now
        light.intensity = isOn ? 1.5 : 0;

        // Change candle material emissive based on state
        if (isOn) {
            candleMat.emissive.setHex(0x332200);
        } else {
            candleMat.emissive.setHex(0x000000);
        }
    };

    // Set initial emissive
    candleMat.emissive.setHex(0x332200);

    // Add toggle to main interactive system
    if (typeof registerInteractiveObject === 'function') {
        registerInteractiveObject(group, toggleLight);
    }

    // Position on table
    // Table Top -2.75.
    // Base is at y=0 local, so set group y to -2.75.
    group.position.set(-6, -2.75, 4);
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // --- Physics ---
    const totalHeight = baseHeight + bodyHeight + capHeight + ventHeight + 0.4; // +0.4 for handle roughly
    // Cylinder shape centered at origin, but group origin is at bottom visually.
    // So we offset the group visual components up, or let createStaticBody use group's position
    // and assume center of mass is at group origin.
    // Wait, the meshes are placed positively on Y axis.
    // If we want the physics shape to match, it needs to be centered at Y = totalHeight / 2.
    // Let's adjust the group visually so origin is centered, and move the group down to table.

    const halfHeight = totalHeight / 2;

    // Adjust children
    group.children.forEach(child => {
        child.position.y -= halfHeight;
    });

    // Now group center is middle of lantern.
    // Table top -2.75.
    // Group Y = -2.75 + halfHeight
    group.position.y = -2.75 + halfHeight;

    const shape = new ammo.btCylinderShape(new ammo.btVector3(bodyRadiusTop + 0.05, halfHeight, bodyRadiusTop + 0.05));
    createStaticBody(physicsWorld, group, shape);

    // Flicker update function
    const update = (time) => {
        if (!isOn) return;

        // Gentle flicker
        const flicker = Math.sin(time * 10) * 0.1 + Math.sin(time * 25) * 0.05;
        light.intensity = 1.5 + flicker;

        // Slight position jitter for flame movement
        light.position.x = (Math.random() - 0.5) * 0.02;
        light.position.z = (Math.random() - 0.5) * 0.02;
    };

    return {
        group,
        update
    };
}
