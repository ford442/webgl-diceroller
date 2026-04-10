import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { createFire } from './Fire.js';

export function createCandelabra(scene, physicsWorld, position = { x: 0, y: -2.75, z: -10 }, rotationY = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Candelabra';

    // Materials
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.2
    });

    const waxMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5e0,      // Warm off-white wax
        roughness: 0.4,
        metalness: 0.0,
        emissive: 0x221a10,
        emissiveIntensity: 0.1
    });

    const wickMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 1.0,
        emissive: 0x331100,
        emissiveIntensity: 0.3
    });

    // 1. Base
    const baseGeo = new THREE.CylinderGeometry(0.8, 1.2, 0.2, 16);
    const baseMesh = new THREE.Mesh(baseGeo, brassMat);
    baseMesh.position.y = 0.1;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Main Stem
    const stemGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.5, 16);
    const stemMesh = new THREE.Mesh(stemGeo, brassMat);
    stemMesh.position.y = 0.95;
    stemMesh.castShadow = true;
    stemMesh.receiveShadow = true;
    group.add(stemMesh);

    const stemNodeGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const stemNodeMesh = new THREE.Mesh(stemNodeGeo, brassMat);
    stemNodeMesh.position.y = 1.0;
    group.add(stemNodeMesh);

    // Array to store flame references for updating
    const flames = [];

    // Helper to add a candle and its cup
    function addCandle(parent, offsetX, offsetY, offsetZ) {
        // Cup
        const cupGeo = new THREE.CylinderGeometry(0.3, 0.2, 0.2, 16);
        const cupMesh = new THREE.Mesh(cupGeo, brassMat);
        cupMesh.position.set(offsetX, offsetY, offsetZ);
        cupMesh.castShadow = true;
        parent.add(cupMesh);

        // Candle Wax
        const candleHeight = 0.8 + Math.random() * 0.4; // Varying height
        const candleGeo = new THREE.CylinderGeometry(0.15, 0.15, candleHeight, 16);
        const candleMesh = new THREE.Mesh(candleGeo, waxMaterial);
        candleMesh.position.set(offsetX, offsetY + 0.1 + candleHeight / 2, offsetZ);
        candleMesh.castShadow = true;
        parent.add(candleMesh);

        // Wick
        const wickHeight = 0.1;
        const wickGeo = new THREE.CylinderGeometry(0.02, 0.02, wickHeight, 8);
        const wickMesh = new THREE.Mesh(wickGeo, wickMat);
        wickMesh.position.set(offsetX, offsetY + 0.1 + candleHeight + wickHeight / 2, offsetZ);
        parent.add(wickMesh);

        // Flame
        const fire = createFire({
            scale: 0.3,
            color: 0xffaa00,
            particleCount: 15,
            spread: 0.05
        });
        fire.mesh.position.set(offsetX, offsetY + 0.1 + candleHeight + wickHeight, offsetZ);
        parent.add(fire.mesh);

        // Small point light for the flame
        const flameLight = new THREE.PointLight(0xff6600, 0.5, 5);
        flameLight.position.copy(fire.mesh.position);
        parent.add(flameLight);

        flames.push({ fire, light: flameLight });
    }

    // 3. Center Candle
    addCandle(group, 0, 1.7, 0);

    // 4. Arms
    const numArms = 4;
    const armRadius = 1.0;
    const armHeight = 1.4;

    for (let i = 0; i < numArms; i++) {
        const angle = (i / numArms) * Math.PI * 2;

        // Arm path
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(Math.cos(angle) * 0.2, 1.0, Math.sin(angle) * 0.2), // Start at center node
            new THREE.Vector3(Math.cos(angle) * armRadius * 0.6, 0.8, Math.sin(angle) * armRadius * 0.6), // Dip down
            new THREE.Vector3(Math.cos(angle) * armRadius, armHeight - 0.2, Math.sin(angle) * armRadius) // Curve up to cup
        ]);

        const armGeo = new THREE.TubeGeometry(curve, 16, 0.08, 8, false);
        const armMesh = new THREE.Mesh(armGeo, brassMat);
        armMesh.castShadow = true;
        armMesh.receiveShadow = true;
        group.add(armMesh);

        // Add candle at the end of the arm
        addCandle(group, Math.cos(angle) * armRadius, armHeight, Math.sin(angle) * armRadius);
    }

    // Position on Table
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics
    // We will use a main cylinder for the stem and a larger cylinder for the base.
    // Base shape
    const baseShape = new ammo.btCylinderShape(new ammo.btVector3(1.2, 0.1, 1.2));

    // Create base body manually to offset it correctly
    const transform = new ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new ammo.btVector3(position.x, position.y + 0.1, position.z));

    const q = new ammo.btQuaternion(group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w);
    transform.setRotation(q);

    const motionState = new ammo.btDefaultMotionState(transform);
    const localInertia = new ammo.btVector3(0, 0, 0);

    const rbInfo = new ammo.btRigidBodyConstructionInfo(0, motionState, baseShape, localInertia);
    const body = new ammo.btRigidBody(rbInfo);
    physicsWorld.addRigidBody(body);

    // Main Stem shape
    const stemShape = new ammo.btCylinderShape(new ammo.btVector3(armRadius + 0.2, 1.5, armRadius + 0.2));
    const stemTransform = new ammo.btTransform();
    stemTransform.setIdentity();
    stemTransform.setOrigin(new ammo.btVector3(position.x, position.y + 1.5, position.z));
    stemTransform.setRotation(q);

    const stemMotionState = new ammo.btDefaultMotionState(stemTransform);
    const stemRbInfo = new ammo.btRigidBodyConstructionInfo(0, stemMotionState, stemShape, localInertia);
    const stemBody = new ammo.btRigidBody(stemRbInfo);
    physicsWorld.addRigidBody(stemBody);


    function update(deltaTime, time) {
        flames.forEach(f => {
            f.fire.update(deltaTime);

            // Flickering
            const breathing = Math.sin(time * 2.0 + Math.random()) * 0.1;
            const flicker = (Math.random() - 0.5) * 0.1;
            f.light.intensity = 0.5 + breathing + flicker;

            // Subtle color shift
            const hueShift = Math.sin(time * 3) * 0.05;
            f.light.color.setHSL(0.08 + hueShift, 1.0, 0.5);
        });
    }

    return {
        group: group,
        update: update
    };
}