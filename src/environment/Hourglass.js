import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createHourglass(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'Hourglass';

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.8
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.9,
        transparent: true,
        thickness: 0.1,
        ior: 1.5
    });

    const sandMat = new THREE.MeshStandardMaterial({
        color: 0xeedd82, // Light goldenrod
        roughness: 1.0
    });

    // Dimensions
    const radius = 0.6;
    const height = 2.0;
    const plateHeight = 0.1;

    // 1. Top & Bottom Plates (Hexagonal)
    const plateGeo = new THREE.CylinderGeometry(radius, radius, plateHeight, 6);

    const topPlate = new THREE.Mesh(plateGeo, woodMat);
    topPlate.position.y = height / 2 - plateHeight / 2;
    topPlate.castShadow = true;
    topPlate.receiveShadow = true;
    group.add(topPlate);

    const botPlate = new THREE.Mesh(plateGeo, woodMat);
    botPlate.position.y = -height / 2 + plateHeight / 2;
    botPlate.castShadow = true;
    botPlate.receiveShadow = true;
    group.add(botPlate);

    // 2. Rods (3 rods)
    const rodRadius = 0.05;
    const rodGeo = new THREE.CylinderGeometry(rodRadius, rodRadius, height - plateHeight * 2, 8);

    for (let i = 0; i < 3; i++) {
        const angle = (Math.PI * 2 / 3) * i;
        const rod = new THREE.Mesh(rodGeo, woodMat);
        const rDist = radius * 0.8;
        rod.position.set(Math.cos(angle) * rDist, 0, Math.sin(angle) * rDist);
        rod.castShadow = true;
        rod.receiveShadow = true;
        group.add(rod);
    }

    // 3. Glass Bulbs (2 Cones meeting)
    // Total glass height ~ height - plateHeight*2.
    // Each cone height ~ (height - plateHeight*2) / 2.
    const glassH = (height - plateHeight * 2) / 2 - 0.05; // gap
    const coneGeo = new THREE.ConeGeometry(radius * 0.7, glassH, 32);

    // Top Bulb (Point down)
    const topBulb = new THREE.Mesh(coneGeo, glassMat);
    // ConeGeometry: Base at -h/2, Tip at h/2.
    // We want Tip at 0. So Center at +h/2.
    // But we want it Pointing DOWN.
    // Rotate X PI. Now Tip is at -h/2 relative to mesh center?
    // Let's visualize:
    // Identity: Base Bottom (-h/2), Tip Top (+h/2).
    // Rotate PI: Base Top (+h/2), Tip Bottom (-h/2).
    // We want Tip at 0. So Center at +h/2.
    // Tip is at Center - h/2 = +h/2 - h/2 = 0. Correct.
    topBulb.rotation.x = Math.PI;
    topBulb.position.y = glassH / 2;
    group.add(topBulb);

    // Bottom Bulb (Point up)
    const botBulb = new THREE.Mesh(coneGeo, glassMat);
    // Identity: Tip Top. We want Tip at 0.
    // So Center at -h/2.
    // Tip is at Center + h/2 = -h/2 + h/2 = 0. Correct.
    botBulb.position.y = -glassH / 2;
    group.add(botBulb);

    // 4. Sand
    // Bottom pile inside Bottom Bulb
    // BotBulb Base is at -glassH.
    // Sand Pile approx half height of bulb.
    const sandH = glassH * 0.5;
    const sandGeo = new THREE.ConeGeometry(radius * 0.7 * 0.5, sandH, 32);
    const sandPile = new THREE.Mesh(sandGeo, sandMat);
    // Sit at bottom of botBulb space.
    // BotBulb Base is at -glassH.
    // Sand Base at -glassH.
    // Sand Center at -glassH + sandH/2.
    sandPile.position.y = -glassH + sandH / 2;
    group.add(sandPile);

    // Trickle (Thin cylinder)
    const trickleGeo = new THREE.CylinderGeometry(0.02, 0.02, glassH, 8);
    const trickle = new THREE.Mesh(trickleGeo, sandMat);
    // Center at 0? No, from 0 down to pile.
    // Starts at 0, ends at -glassH + sandH.
    // Length = glassH - sandH.
    // Center = - (glassH - sandH) / 2.
    // But simplified: just center at -glassH/2 (middle of bot bulb)
    trickle.position.y = -glassH / 2;
    group.add(trickle);

    // Position in World
    // Table Top -2.75.
    // Group Origin is center of Hourglass (height 2.0).
    // Bottom of Hourglass is -1.0 relative to group.
    // We want -1.0 (local) to be at -2.75 (world).
    // Group Y = -2.75 + 1.0 = -1.75.

    group.position.set(-6, -1.75, 0);
    group.rotation.y = Math.random() * Math.PI;

    scene.add(group);

    // Physics
    if (physicsWorld) {
        const ammo = getAmmo();
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height / 2, radius));
        createStaticBody(physicsWorld, group, shape);
    }

    return group;
}
