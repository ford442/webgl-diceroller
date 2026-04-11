import * as THREE from 'three';
import { createStaticBody } from '../physics.js';

export function createCandelabra(scene, physicsWorld, position, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'Candelabra';
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    // Materials
    const brassMaterial = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        roughness: 0.3,
        metalness: 0.8,
    });

    const waxMaterial = new THREE.MeshStandardMaterial({
        color: 0xfffdd0,
        roughness: 0.7,
        metalness: 0.1,
        transparent: true,
        opacity: 0.9,
    });

    // Base
    const baseGeo = new THREE.CylinderGeometry(0.8, 1.2, 0.4, 16);
    const baseMesh = new THREE.Mesh(baseGeo, brassMaterial);
    baseMesh.position.y = 0.2;
    group.add(baseMesh);

    // Stem
    const stemGeo = new THREE.CylinderGeometry(0.2, 0.3, 3.0, 16);
    const stemMesh = new THREE.Mesh(stemGeo, brassMaterial);
    stemMesh.position.y = 1.9; // 0.4 + 1.5
    group.add(stemMesh);

    // Center cup
    const cupGeo = new THREE.CylinderGeometry(0.4, 0.2, 0.4, 16);
    const centerCup = new THREE.Mesh(cupGeo, brassMaterial);
    centerCup.position.y = 3.6; // 3.4 + 0.2
    group.add(centerCup);

    // Arms
    const armGeo = new THREE.TorusGeometry(1.0, 0.15, 8, 16, Math.PI);
    const arm1 = new THREE.Mesh(armGeo, brassMaterial);
    arm1.position.set(0, 2.5, 0);
    arm1.rotation.x = Math.PI;
    group.add(arm1);

    const arm2 = new THREE.Mesh(armGeo, brassMaterial);
    arm2.position.set(0, 2.5, 0);
    arm2.rotation.x = Math.PI;
    arm2.rotation.y = Math.PI / 2;
    group.add(arm2);

    // Side cups
    const cupPositions = [
        { x: 1.0, z: 0 },
        { x: -1.0, z: 0 },
        { x: 0, z: 1.0 },
        { x: 0, z: -1.0 }
    ];

    cupPositions.forEach(pos => {
        const sideCup = new THREE.Mesh(cupGeo, brassMaterial);
        sideCup.position.set(pos.x, 2.7, pos.z);
        group.add(sideCup);
    });

    // Candles and Lights
    const candles = [];
    const lights = [];

    // Add center candle
    cupPositions.push({ x: 0, z: 0, isCenter: true });

    cupPositions.forEach(pos => {
        const yOffset = pos.isCenter ? 3.8 : 2.9;

        // Candle body
        const candleHeight = 1.0 + Math.random() * 0.5;
        const candleGeo = new THREE.CylinderGeometry(0.25, 0.25, candleHeight, 16);
        const candle = new THREE.Mesh(candleGeo, waxMaterial);
        candle.position.set(pos.x, yOffset + candleHeight/2, pos.z);
        group.add(candle);
        candles.push(candle);

        // Wick
        const wickGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 4);
        const wickMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
        const wick = new THREE.Mesh(wickGeo, wickMat);
        wick.position.set(0, candleHeight/2 + 0.05, 0);
        candle.add(wick);

        // Point Light
        const light = new THREE.PointLight(0xffa500, 2.0, 10.0);
        light.position.set(0, candleHeight/2 + 0.2, 0);
        // Reduce shadow intensity and map size to optimize
        light.castShadow = true;
        light.shadow.bias = -0.001;
        candle.add(light);

        lights.push({ light, baseIntensity: 1.5 + Math.random() * 1.0, offset: Math.random() * 100 });
    });

    scene.add(group);

    // Physics (Static Box covering the base and arms)
    // We use global AmmoInstance
    const w = 1.2;
    const h = 2.5; // Half height
    const d = 1.2;

    // Y offset to put origin of physics shape correctly.
    // Half height is 2.5. So center of shape is 2.5.
    const shape = new AmmoInstance.btBoxShape(new AmmoInstance.btVector3(w, h, d));

    // Offset the physics body
    // Create a dummy mesh for positioning
    const dummyMesh = new THREE.Mesh();
    dummyMesh.position.set(position.x, position.y + h, position.z);
    dummyMesh.rotation.y = rotationY;

    const body = createStaticBody(physicsWorld, dummyMesh, shape);

    return {
        group,
        update: (deltaTime, time) => {
            lights.forEach(lightData => {
                const { light, baseIntensity, offset } = lightData;
                // Flicker calculation
                const flicker = Math.sin(time * 15.0 + offset) * 0.2 +
                                Math.sin(time * 25.0 - offset) * 0.1 +
                                Math.random() * 0.05;
                light.intensity = Math.max(0.1, baseIntensity + flicker);
            });
        }
    };
}
