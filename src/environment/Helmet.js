import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createHelmet(scene, physicsWorld, position = { x: -16, y: -2.75, z: 8 }, rotationY = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'IronHelmet';

    // Dimensions
    const helmetRadius = 0.8;
    const helmetHeight = 0.9;

    // Materials
    const ironMat = new THREE.MeshStandardMaterial({
        color: 0x555555,
        metalness: 0.8,
        roughness: 0.4,
    });

    const darkIronMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        metalness: 0.9,
        roughness: 0.5,
    });

    const boneMat = new THREE.MeshStandardMaterial({
        color: 0xddddcc,
        roughness: 0.8,
        metalness: 0.1
    });

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 0.9,
        roughness: 0.3
    });

    // 1. Dome (Top half of the helmet)
    const domeGeo = new THREE.SphereGeometry(helmetRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMesh = new THREE.Mesh(domeGeo, ironMat);
    // Base of the dome is at y=0. Move it up so it sits on top of the rim.
    domeMesh.position.y = 0.4;
    domeMesh.castShadow = true;
    domeMesh.receiveShadow = true;
    group.add(domeMesh);

    // 2. Base Ring / Lower part
    const ringGeo = new THREE.CylinderGeometry(helmetRadius, helmetRadius, 0.4, 32, 1, true);
    const ringMesh = new THREE.Mesh(ringGeo, ironMat);
    ringMesh.position.y = 0.2; // center of the 0.4 cylinder is at 0.2, bottom is at 0.
    ringMesh.castShadow = true;
    ringMesh.receiveShadow = true;
    // For a cylinder to be open and have depth, we can use a tube or multiple cylinders,
    // or just assume standard material is double sided
    ringMesh.material.side = THREE.DoubleSide;
    group.add(ringMesh);

    // 3. Trim / Rim at the bottom
    const trimGeo = new THREE.TorusGeometry(helmetRadius, 0.05, 16, 32);
    const trimMesh = new THREE.Mesh(trimGeo, darkIronMat);
    trimMesh.rotation.x = Math.PI / 2;
    trimMesh.position.y = 0.05;
    trimMesh.castShadow = true;
    group.add(trimMesh);

    // Middle Trim
    const midTrimGeo = new THREE.TorusGeometry(helmetRadius + 0.01, 0.04, 16, 32);
    const midTrimMesh = new THREE.Mesh(midTrimGeo, goldMat);
    midTrimMesh.rotation.x = Math.PI / 2;
    midTrimMesh.position.y = 0.4;
    midTrimMesh.castShadow = true;
    group.add(midTrimMesh);

    // 4. Nose Guard
    const noseGeo = new THREE.BoxGeometry(0.2, 0.6, 0.1);
    const noseMesh = new THREE.Mesh(noseGeo, goldMat);
    noseMesh.position.set(0, 0.4, helmetRadius + 0.02);
    noseMesh.castShadow = true;
    noseMesh.receiveShadow = true;
    group.add(noseMesh);

    // 5. Horns
    const hornGeo = new THREE.ConeGeometry(0.2, 0.8, 16);

    // Left Horn
    const leftHorn = new THREE.Mesh(hornGeo, boneMat);
    leftHorn.position.set(-helmetRadius - 0.1, 0.7, 0);
    leftHorn.rotation.z = Math.PI / 4;
    leftHorn.castShadow = true;
    leftHorn.receiveShadow = true;
    group.add(leftHorn);

    // Right Horn
    const rightHorn = new THREE.Mesh(hornGeo, boneMat);
    rightHorn.position.set(helmetRadius + 0.1, 0.7, 0);
    rightHorn.rotation.z = -Math.PI / 4;
    rightHorn.castShadow = true;
    rightHorn.receiveShadow = true;
    group.add(rightHorn);

    // Horn bases
    const hornBaseGeo = new THREE.TorusGeometry(0.22, 0.05, 16, 16);
    const leftHornBase = new THREE.Mesh(hornBaseGeo, goldMat);
    leftHornBase.position.set(-helmetRadius + 0.02, 0.55, 0);
    leftHornBase.rotation.y = Math.PI / 2;
    leftHornBase.rotation.x = -Math.PI / 4;
    group.add(leftHornBase);

    const rightHornBase = new THREE.Mesh(hornBaseGeo, goldMat);
    rightHornBase.position.set(helmetRadius - 0.02, 0.55, 0);
    rightHornBase.rotation.y = Math.PI / 2;
    rightHornBase.rotation.x = Math.PI / 4;
    group.add(rightHornBase);

    // Position in world
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics ---
    // The physics shape origin is at the center of the cylinder.
    // The visual group's Y origin is at the bottom (y=0).
    const physHeight = helmetHeight;
    const physRadius = helmetRadius + 0.05; // Slightly larger to encompass details

    const shape = new ammo.btCylinderShape(new ammo.btVector3(physRadius, physHeight / 2, physRadius));

    // Shift visual meshes down relative to group, and move group up.
    group.position.y = position.y + physHeight / 2;

    const childrenToMove = [...group.children];
    childrenToMove.forEach(child => {
        child.position.y -= physHeight / 2;
    });

    createStaticBody(physicsWorld, group, shape);

    return {
        group
    };
}
