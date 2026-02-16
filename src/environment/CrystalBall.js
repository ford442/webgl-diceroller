import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createCrystalBall(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'CrystalBall';

    // 1. Stand Geometry & Material
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        metalness: 0.8
    });

    // Base
    const baseRadius = 0.4;
    const baseHeight = 0.1;
    const baseGeo = new THREE.CylinderGeometry(baseRadius * 0.8, baseRadius, baseHeight, 16);
    const baseMesh = new THREE.Mesh(baseGeo, goldMat);
    baseMesh.receiveShadow = true;
    baseMesh.castShadow = true;
    group.add(baseMesh);

    // Stem
    const stemHeight = 0.3;
    const stemGeo = new THREE.CylinderGeometry(0.1, 0.15, stemHeight, 8);
    const stemMesh = new THREE.Mesh(stemGeo, goldMat);
    stemMesh.receiveShadow = true;
    stemMesh.castShadow = true;
    group.add(stemMesh);

    // Holder Cup (Torus Rim)
    const cupRadius = 0.35;
    const rimGeo = new THREE.TorusGeometry(cupRadius, 0.04, 8, 16);
    const rimMesh = new THREE.Mesh(rimGeo, goldMat);
    rimMesh.rotation.x = Math.PI / 2;
    group.add(rimMesh);

    // 2. Crystal Sphere
    const sphereRadius = 0.5;
    const sphereGeo = new THREE.SphereGeometry(sphereRadius, 32, 32);
    const crystalMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.05,
        transmission: 0.9,
        thickness: 1.0,
        ior: 1.5,
        clearcoat: 1.0,
        transparent: true
    });
    const sphereMesh = new THREE.Mesh(sphereGeo, crystalMat);
    sphereMesh.receiveShadow = true;
    group.add(sphereMesh);

    // 3. Inner Glow (Point Light)
    const glowLight = new THREE.PointLight(0xaa00ff, 2.0, 3.0);
    glowLight.castShadow = false;
    group.add(glowLight);

    // 4. Inner Core (Emissive)
    const coreGeo = new THREE.IcosahedronGeometry(0.15, 0);
    const coreMat = new THREE.MeshStandardMaterial({
        color: 0xff00ff,
        emissive: 0xaa00ff,
        emissiveIntensity: 2.0,
        roughness: 0.8,
        transparent: true,
        opacity: 0.8
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    group.add(coreMesh);


    // --- Positioning & Physics Alignment ---

    // Target World Position (On Table)
    // Table Top Y = -2.75.
    const targetY = -2.75;
    const targetX = 6;
    const targetZ = -4;

    // Relative positions calculations
    // Base bottom at Y=0 (relative to local start)
    const baseY = baseHeight / 2; // 0.05
    const stemY = baseHeight + stemHeight / 2; // 0.25
    const rimY = baseHeight + stemHeight; // 0.4
    const sphereY = baseHeight + stemHeight + sphereRadius - 0.1; // 0.8 (overlap 0.1)

    // Apply calculated positions
    baseMesh.position.y = baseY;
    stemMesh.position.y = stemY;
    rimMesh.position.y = rimY;
    sphereMesh.position.y = sphereY;
    glowLight.position.y = sphereY;
    coreMesh.position.y = sphereY;

    // Calculate Center Offset for Physics
    // Total Height approx = sphereY + sphereRadius = 0.8 + 0.5 = 1.3.
    const totalHeight = 1.3;
    const centerOffset = totalHeight / 2; // 0.65

    // Adjust Visuals DOWN
    baseMesh.position.y -= centerOffset;
    stemMesh.position.y -= centerOffset;
    rimMesh.position.y -= centerOffset;
    sphereMesh.position.y -= centerOffset;
    glowLight.position.y -= centerOffset;
    coreMesh.position.y -= centerOffset;

    // Adjust Group Position UP
    group.position.set(targetX, targetY + centerOffset, targetZ);

    scene.add(group);

    // Physics
    const ammo = getAmmo();
    // Cylinder shape (halfExtents)
    const shape = new ammo.btCylinderShape(new ammo.btVector3(sphereRadius, centerOffset, sphereRadius));

    createStaticBody(physicsWorld, group, shape);
}
