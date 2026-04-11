import * as THREE from 'three';
import { getAmmo } from '../physics.js';
import { createFire } from './Fire.js';

export function createCandelabra(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotationY = 0
) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Candelabra';

    // Materials (best of both versions – rich brass + warm wax + emissive wick)
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.2,
    });

    const waxMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5e0,
        roughness: 0.4,
        metalness: 0.0,
        emissive: 0x221a10,
        emissiveIntensity: 0.1,
    });

    const wickMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 1.0,
        emissive: 0x331100,
        emissiveIntensity: 0.3,
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

    // Stem decorative node
    const stemNodeGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const stemNodeMesh = new THREE.Mesh(stemNodeGeo, brassMat);
    stemNodeMesh.position.y = 1.0;
    group.add(stemNodeMesh);

    // Store flames for animation
    const flames = [];

    // Helper to create a candle + cup + wick + fire at any location
    function addCandle(parent, offsetX, offsetY, offsetZ) {
        // Cup
        const cupGeo = new THREE.CylinderGeometry(0.3, 0.2, 0.2, 16);
        const cupMesh = new THREE.Mesh(cupGeo, brassMat);
        cupMesh.position.set(offsetX, offsetY, offsetZ);
        cupMesh.castShadow = true;
        parent.add(cupMesh);

        // Candle wax (slightly randomized height)
        const candleHeight = 0.8 + Math.random() * 0.4;
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

        // Realistic fire particle system (from Fire.js)
        const fire = createFire({
            scale: 0.3,
            color: 0xffaa00,
            particleCount: 15,
            spread: 0.05,
        });
        fire.mesh.position.set(offsetX, offsetY + 0.1 + candleHeight + wickHeight, offsetZ);
        parent.add(fire.mesh);

        // Flame point light
        const flameLight = new THREE.PointLight(0xff6600, 0.5, 5);
        flameLight.position.copy(fire.mesh.position);
        parent.add(flameLight);

        flames.push({ fire, light: flameLight });
    }

    // Center candle
    addCandle(group, 0, 1.7, 0);

    // 4 curved arms + candles (much more elegant than the old torus arms)
    const numArms = 4;
    const armRadius = 1.0;
    const armHeight = 1.4;

    for (let i = 0; i < numArms; i++) {
        const angle = (i / numArms) * Math.PI * 2;

        // Smooth curved arm using CatmullRomCurve3
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(Math.cos(angle) * 0.2, 1.0, Math.sin(angle) * 0.2), // start at center
            new THREE.Vector3(Math.cos(angle) * armRadius * 0.6, 0.8, Math.sin(angle) * armRadius * 0.6), // dip
            new THREE.Vector3(Math.cos(angle) * armRadius, armHeight - 0.2, Math.sin(angle) * armRadius), // end at cup
        ]);

        const armGeo = new THREE.TubeGeometry(curve, 16, 0.08, 8, false);
        const armMesh = new THREE.Mesh(armGeo, brassMat);
        armMesh.castShadow = true;
        armMesh.receiveShadow = true;
        group.add(armMesh);

        // Candle at the end of each arm
        addCandle(group, Math.cos(angle) * armRadius, armHeight, Math.sin(angle) * armRadius);
    }

    // Final positioning & rotation
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics – two static cylinder bodies (base + wide stem/arms envelope)
    // Base
    const baseShape = new ammo.btCylinderShape(new ammo.btVector3(1.2, 0.1, 1.2));
    const transform = new ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new ammo.btVector3(position.x, position.y + 0.1, position.z));
    const q = new ammo.btQuaternion(group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w);
    transform.setRotation(q);

    const motionState = new ammo.btDefaultMotionState(transform);
    const localInertia = new ammo.btVector3(0, 0, 0);
    const rbInfo = new ammo.btRigidBodyConstructionInfo(0, motionState, baseShape, localInertia);
    const baseBody = new ammo.btRigidBody(rbInfo);
    physicsWorld.addRigidBody(baseBody);

    // Stem + arms envelope (slightly wider radius to cover the curved arms)
    const stemShape = new ammo.btCylinderShape(new ammo.btVector3(1.3, 1.2, 1.3));
    const stemTransform = new ammo.btTransform();
    stemTransform.setIdentity();
    stemTransform.setOrigin(new ammo.btVector3(position.x, position.y + 1.8, position.z));
    stemTransform.setRotation(q);

    const stemMotionState = new ammo.btDefaultMotionState(stemTransform);
    const stemRbInfo = new ammo.btRigidBodyConstructionInfo(0, stemMotionState, stemShape, localInertia);
    const stemBody = new ammo.btRigidBody(stemRbInfo);
    physicsWorld.addRigidBody(stemBody);

    // Animation loop (fire particles + realistic flickering light)
    function update(deltaTime, time) {
        flames.forEach((f) => {
            f.fire.update(deltaTime);

            // Gentle breathing + random flicker
            const breathing = Math.sin(time * 2.0) * 0.08;
            const flicker = (Math.random() - 0.5) * 0.12;
            f.light.intensity = 0.5 + breathing + flicker;

            // Subtle warm color shift
            const hueShift = Math.sin(time * 3.5) * 0.03;
            f.light.color.setHSL(0.08 + hueShift, 1.0, 0.52);
        });
    }

    return {
        group,
        update,
        // Optional cleanup (recommended for long-lived scenes)
        remove() {
            physicsWorld.removeRigidBody(baseBody);
            physicsWorld.removeRigidBody(stemBody);
            // Ammo.js bodies should also be deleted if you want to free memory:
            // ammo.destroy(baseBody); ammo.destroy(stemBody); etc.
            scene.remove(group);
        },
    };
}