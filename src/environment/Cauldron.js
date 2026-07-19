import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createCauldron(scene, physicsWorld, position = { x: 12, y: -2.75, z: -4 }, rotation = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Cauldron';

    // Materials
    const castIronMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.8,
        metalness: 0.6,
        bumpScale: 0.05
    });

    const liquidMat = new THREE.MeshStandardMaterial({
        color: 0x22ff22, // Glowing green
        emissive: 0x11aa11,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.9
    });

    // --- Cauldron Body ---
    // We use a SphereGeometry with phi/theta parameters to make a bowl shape
    // Note: thetaStart = Math.PI * 0.25, thetaLength = Math.PI * 0.75 makes an open bowl shape
    const radius = 1.2;
    // theta is measured from top pole (Y+) downwards.
    // If we start at 0 and go to PI/2 it's the top hemisphere.
    // To make a cauldron (bowl shape), we start at some angle past 0, or just draw the bottom hemisphere.
    // Actually, starting at Math.PI/2 (equator) to Math.PI (bottom) is just half.
    // A cauldron is more than half. Let's start at Math.PI * 0.25, go to Math.PI.
    const thetaStart = Math.PI * 0.25;
    const thetaLength = Math.PI - thetaStart;

    const bodyGeo = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, thetaStart, thetaLength);
    const body = new THREE.Mesh(bodyGeo, castIronMat);
    // Move up so the bottom rests at y=legHeight
    // The lowest point is at -radius (relative to sphere center). So center should be legHeight + radius
    const legHeight = 0.8;
    const centerHeight = legHeight + radius;
    body.position.y = centerHeight;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // --- Rim ---
    // Rim is at the top opening, which is at angle thetaStart.
    const rimRadius = Math.sin(thetaStart) * radius;
    const rimHeight = centerHeight + Math.cos(thetaStart) * radius;
    const rimGeo = new THREE.TorusGeometry(rimRadius, 0.1, 16, 32);
    const rim = new THREE.Mesh(rimGeo, castIronMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = rimHeight;
    rim.castShadow = true;
    group.add(rim);

    // --- Legs ---
    const legRadius = 0.1;
    const legGeo = new THREE.CylinderGeometry(legRadius * 0.5, legRadius, legHeight, 8);

    for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const leg = new THREE.Mesh(legGeo, castIronMat);

        // Position legs around the bottom
        // Find radius at the attachment point (e.g., lower down the sphere)
        const attachmentAngle = Math.PI * 0.8;
        const attachmentRadius = Math.sin(attachmentAngle) * radius;

        leg.position.set(Math.cos(angle) * attachmentRadius, legHeight / 2, Math.sin(angle) * attachmentRadius);

        // Splay the legs outward
        leg.lookAt(new THREE.Vector3(Math.cos(angle) * radius * 2, legHeight / 2, Math.sin(angle) * radius * 2));
        leg.rotateX(Math.PI / 2);
        leg.rotateX(-Math.PI / 6); // Adjust splay angle

        leg.castShadow = true;
        leg.receiveShadow = true;
        group.add(leg);
    }

    // --- Handles ---
    const handleGeo = new THREE.TorusGeometry(0.2, 0.05, 8, 16);
    for (let i = 0; i < 2; i++) {
        const handle = new THREE.Mesh(handleGeo, castIronMat);
        handle.position.set((i === 0 ? 1 : -1) * (rimRadius + 0.1), rimHeight - 0.2, 0);
        handle.rotation.y = Math.PI / 2;
        handle.castShadow = true;
        group.add(handle);
    }

    // --- Glowing Liquid ---
    // Liquid surface slightly below rim
    const liquidRadius = rimRadius * 0.95;
    const liquidGeo = new THREE.CylinderGeometry(liquidRadius, liquidRadius, 0.05, 32);
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    const liquidHeight = rimHeight - 0.2;
    liquid.position.y = liquidHeight;
    liquid.receiveShadow = true;
    group.add(liquid);

    // --- Light ---
    const glowLight = new THREE.PointLight(0x22ff22, 1.5, 6);
    glowLight.position.y = liquidHeight + 0.5;
    group.add(glowLight);

    // Position and add to scene
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotation;
    scene.add(group);

    // --- Animation / Update ---
    let timeOffset = Math.random() * 100;
    const update = (deltaTime, time) => {
        const t = time + timeOffset;
        // Flicker light intensity
        glowLight.intensity = 1.0 + Math.sin(t * 5) * 0.2 + Math.cos(t * 3.1) * 0.1;

        // Liquid wobble/ripple (simple vertical translation)
        liquid.position.y = liquidHeight + Math.sin(t * 2) * 0.02;
    };

    // --- Physics ---
    if (ammo) {
        // Approximate physics with a cylinder
        const physRadius = radius + 0.1;
        // Physics body covers from bottom of the cauldron up to the rim
        // Total height from bottom to rim is rimHeight.
        const totalHeight = rimHeight;
        if (ammo && physicsWorld) {
            const shape = new ammo.btCylinderShape(new ammo.btVector3(physRadius, totalHeight / 2, physRadius));
    
            const dummy = new THREE.Object3D();
            dummy.position.copy(group.position);
            dummy.position.y += totalHeight / 2;
            dummy.quaternion.copy(group.quaternion);
    
            createStaticBody(physicsWorld, dummy, shape);
        }
    }

    return { group, update };
}
