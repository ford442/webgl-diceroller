import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { playPropImpact } from '../audio/DiceCollisionAudio.js';

export function createGong(scene, physicsWorld, position = { x: -15, y: -7.5, z: -15 }, rotationY = Math.PI / 4) {
    const group = new THREE.Group();
    group.name = 'Gong';

    // Materials
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xd4a853, // Brass/bronze color
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x221100,
        emissiveIntensity: 0.1
    });

    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033, // Dark wood
        roughness: 0.8,
        metalness: 0.0
    });

    // --- Geometry ---

    // 1. Gong Disc (Main resonating body)
    const gongRadius = 1.2;
    const gongThickness = 0.08;
    const gongGeo = new THREE.CylinderGeometry(gongRadius, gongRadius, gongThickness, 32);
    const gongMesh = new THREE.Mesh(gongGeo, brassMat);
    gongMesh.rotation.z = Math.PI / 2; // Hang vertically
    gongMesh.castShadow = true;
    gongMesh.receiveShadow = true;
    gongMesh.name = 'GongDisc';
    group.add(gongMesh);

    // 2. Center boss (raised center of gong)
    const bossRadius = 0.35;
    const bossThickness = 0.12;
    const bossGeo = new THREE.CylinderGeometry(bossRadius, bossRadius, bossThickness, 24);
    const bossMesh = new THREE.Mesh(bossGeo, brassMat);
    bossMesh.rotation.z = Math.PI / 2;
    bossMesh.position.x = 0.02; // Slightly proud of the main disc
    bossMesh.castShadow = true;
    group.add(bossMesh);

    // 3. Wooden Frame - Top Bar
    const frameWidth = 3.5;
    const frameHeight = 0.3;
    const frameDepth = 0.3;
    const topBarGeo = new THREE.BoxGeometry(frameWidth, frameHeight, frameDepth);
    const topBar = new THREE.Mesh(topBarGeo, woodMat);
    topBar.position.y = 2.0;
    topBar.castShadow = true;
    topBar.receiveShadow = true;
    group.add(topBar);

    // 4. Wooden Frame - Side Posts
    const postHeight = 4.0;
    const postSize = 0.25;
    const postGeo = new THREE.BoxGeometry(postSize, postHeight, postSize);
    
    const leftPost = new THREE.Mesh(postGeo, woodMat);
    leftPost.position.set(-1.5, 0, 0);
    leftPost.castShadow = true;
    leftPost.receiveShadow = true;
    group.add(leftPost);

    const rightPost = new THREE.Mesh(postGeo, woodMat);
    rightPost.position.set(1.5, 0, 0);
    rightPost.castShadow = true;
    rightPost.receiveShadow = true;
    group.add(rightPost);

    // 5. Wooden Frame - Base
    const baseWidth = 3.8;
    const baseHeight = 0.4;
    const baseDepth = 1.0;
    const baseGeo = new THREE.BoxGeometry(baseWidth, baseHeight, baseDepth);
    const base = new THREE.Mesh(baseGeo, woodMat);
    base.position.y = -postHeight / 2 + baseHeight / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // 6. Hanging Ropes (Visual - thin cylinders)
    const ropeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    
    const leftRope = new THREE.Mesh(ropeGeo, ropeMat);
    leftRope.position.set(-0.9, 1.6, 0);
    group.add(leftRope);

    const rightRope = new THREE.Mesh(ropeGeo, ropeMat);
    rightRope.position.set(0.9, 1.6, 0);
    group.add(rightRope);

    // 7. Mallet (resting on the side)
    const malletHandleGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8);
    const malletHeadGeo = new THREE.SphereGeometry(0.15, 16, 16);
    
    const malletHandle = new THREE.Mesh(malletHandleGeo, woodMat);
    const malletHead = new THREE.Mesh(malletHeadGeo, brassMat);
    malletHead.position.y = 0.6;
    
    const mallet = new THREE.Group();
    mallet.add(malletHandle);
    mallet.add(malletHead);
    mallet.position.set(1.8, -1.2, 0.3);
    mallet.rotation.z = -Math.PI / 4;
    mallet.rotation.x = Math.PI / 6;
    group.add(mallet);

    // --- Positioning ---
    // Place near a wall/corner of the room
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics ---
    if (physicsWorld) {
        const ammo = getAmmo();
        
        // Box shape for the wooden frame
        const frameShape = new ammo.btBoxShape(new ammo.btVector3(baseWidth / 2, postHeight / 2, baseDepth / 2));
        const framePhysMesh = new THREE.Mesh(
            new THREE.BoxGeometry(baseWidth, postHeight, baseDepth),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        framePhysMesh.position.set(position.x, position.y + baseHeight / 2, position.z);
        scene.add(framePhysMesh);
        createStaticBody(physicsWorld, framePhysMesh, frameShape);

        // Cylinder shape for the gong disc
        const gongPhysMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(gongRadius, gongRadius, gongThickness, 16),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        gongPhysMesh.position.set(position.x, position.y, position.z);
        gongPhysMesh.rotation.z = Math.PI / 2;
        scene.add(gongPhysMesh);
        
        const gongShape = new ammo.btCylinderShape(new ammo.btVector3(gongRadius, gongThickness / 2, gongRadius));
        createStaticBody(physicsWorld, gongPhysMesh, gongShape);
    }

    // --- Interactive Effects ---
    
    // Sound wave rings
    const rings = [];
    const maxRings = 3;
    const ringGeo = new THREE.RingGeometry(0.1, 0.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });

    for (let i = 0; i < maxRings; i++) {
        const ring = new THREE.Mesh(ringGeo, ringMat.clone());
        ring.rotation.y = Math.PI / 2; // Face same direction as gong
        ring.visible = false;
        group.add(ring);
        rings.push({
            mesh: ring,
            active: false,
            startTime: 0,
            delay: i * 0.15 // Staggered start
        });
    }

    // Glow light for impact effect
    const impactLight = new THREE.PointLight(0xffd700, 0, 8);
    impactLight.position.set(0, 0, 0.5);
    group.add(impactLight);

    // Screen flash overlay (will be managed by update function)
    let flashIntensity = 0;
    let isShaking = false;
    let shakeStartTime = 0;
    const shakeDuration = 0.5;

    const triggerGong = () => {
        // Big shimmering metal strike to match the visual flash.
        playPropImpact({ surface: 'gong', volume: 0.85 });
        // Activate rings
        const now = performance.now() / 1000;
        rings.forEach((ring, i) => {
            ring.active = true;
            ring.startTime = now + ring.delay;
            ring.mesh.visible = true;
            ring.mesh.scale.set(1, 1, 1);
            ring.mesh.material.opacity = 0.8;
        });

        // Flash light
        impactLight.intensity = 5;

        // Start shake
        isShaking = true;
        shakeStartTime = now;

        // Flash screen
        flashIntensity = 0.3;
    };

    const update = (deltaTime, elapsedTime) => {
        const now = performance.now() / 1000;

        // Update rings
        rings.forEach(ring => {
            if (!ring.active) return;

            const age = now - ring.startTime;
            if (age < 0) return; // Not started yet

            if (age > 1.5) {
                // Reset
                ring.active = false;
                ring.mesh.visible = false;
                return;
            }

            // Expand
            const scale = 1 + age * 4;
            ring.mesh.scale.set(scale, scale, scale);

            // Fade
            ring.mesh.material.opacity = 0.8 * (1 - age / 1.5);
        });

        // Decay impact light
        if (impactLight.intensity > 0) {
            impactLight.intensity = Math.max(0, impactLight.intensity - deltaTime * 8);
        }

        // Handle shake
        if (isShaking) {
            const shakeAge = now - shakeStartTime;
            if (shakeAge < shakeDuration) {
                const intensity = 1 - (shakeAge / shakeDuration);
                const shakeX = (Math.random() - 0.5) * 0.05 * intensity;
                const shakeY = (Math.random() - 0.5) * 0.05 * intensity;
                gongMesh.position.x = shakeX;
                gongMesh.position.y = shakeY;
                bossMesh.position.x = 0.02 + shakeX;
                bossMesh.position.y = shakeY;
            } else {
                isShaking = false;
                gongMesh.position.set(0, 0, 0);
                bossMesh.position.set(0.02, 0, 0);
            }
        }

        // Decay flash
        if (flashIntensity > 0) {
            flashIntensity = Math.max(0, flashIntensity - deltaTime * 3);
        }
    };

    // Get flash intensity for external screen effect
    const getFlashIntensity = () => flashIntensity;

    return {
        group,
        interact: triggerGong,
        update,
        getFlashIntensity
    };
}
