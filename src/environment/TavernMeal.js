import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createTavernMeal(scene, physicsWorld) {
    const ammo = getAmmo();

    // 1. Tankard of Ale
    createTankard(scene, physicsWorld, ammo);

    // 2. Plate with Food
    createFoodPlate(scene, physicsWorld, ammo);
}

function createTankard(scene, physicsWorld, ammo) {
    const group = new THREE.Group();
    group.name = 'Tankard';

    // Dimensions
    const radius = 0.35;
    const height = 0.8;
    const thickness = 0.05;

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033, // Dark Wood
        roughness: 0.7
    });

    const metalMat = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa, // Steel/Pewter
        metalness: 0.8,
        roughness: 0.4
    });

    const foamMat = new THREE.MeshStandardMaterial({
        color: 0xffffee, // Creamy foam
        roughness: 0.9,
        bumpScale: 0.02
    });

    // Body (Cylinder)
    const bodyGeo = new THREE.CylinderGeometry(radius, radius, height, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, woodMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // Metal Bands (Top and Bottom)
    const bandGeo = new THREE.CylinderGeometry(radius + 0.01, radius + 0.01, 0.1, 16);

    const topBand = new THREE.Mesh(bandGeo, metalMat);
    topBand.position.y = height/2 - 0.1;
    topBand.castShadow = true;
    topBand.receiveShadow = true;
    group.add(topBand);

    const botBand = new THREE.Mesh(bandGeo, metalMat);
    botBand.position.y = -height/2 + 0.1;
    botBand.castShadow = true;
    botBand.receiveShadow = true;
    group.add(botBand);

    // Handle (Torus segment)
    // We want a 'D' shape handle.
    // Torus: radius 0.25, tube 0.05.
    const handleGeo = new THREE.TorusGeometry(0.25, 0.05, 8, 16, Math.PI); // Half torus
    const handleMesh = new THREE.Mesh(handleGeo, metalMat);
    handleMesh.rotation.z = -Math.PI / 2; // Vertical
    handleMesh.position.set(radius, 0, 0); // Side of tankard
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;
    group.add(handleMesh);

    // Foam Head
    // Irregular blob on top
    const foamGeo = new THREE.SphereGeometry(radius - 0.05, 16, 8);
    // Flatten bottom, stretch top
    foamGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.4, 1));
    const foamMesh = new THREE.Mesh(foamGeo, foamMat);
    foamMesh.position.y = height/2 + 0.05;
    group.add(foamMesh);

    // Position on Table
    // Table Top -2.75.
    // Tankard Height 0.8. Center at -2.75 + 0.4 = -2.35.
    // Place at (6, -2, 6) area.
    group.position.set(6, -2.35, 6);
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height/2, radius));
    createStaticBody(physicsWorld, group, shape);
}

function createFoodPlate(scene, physicsWorld, ammo) {
    const group = new THREE.Group();
    group.name = 'FoodPlate';

    // Materials
    const plateMat = new THREE.MeshStandardMaterial({
        color: 0xdddddd, // Greyish white ceramic
        roughness: 0.3
    });

    const breadMat = new THREE.MeshStandardMaterial({
        color: 0xcd853f, // Peru/Brown
        roughness: 0.8
    });

    const cheeseMat = new THREE.MeshStandardMaterial({
        color: 0xffd700, // Gold/Yellow
        roughness: 0.5
    });

    // 1. Plate
    const plateRadius = 0.8;
    const plateHeight = 0.1;
    const plateGeo = new THREE.CylinderGeometry(plateRadius, plateRadius * 0.8, plateHeight, 32);
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.castShadow = true;
    plateMesh.receiveShadow = true;
    group.add(plateMesh);

    // 2. Bread Loaf (Small round loaf)
    const breadGeo = new THREE.SphereGeometry(0.3, 16, 16);
    breadGeo.applyMatrix4(new THREE.Matrix4().makeScale(1.2, 0.7, 1)); // Oval, flattened
    const breadMesh = new THREE.Mesh(breadGeo, breadMat);
    breadMesh.position.set(-0.2, plateHeight/2 + 0.15, -0.2);
    breadMesh.castShadow = true;
    breadMesh.receiveShadow = true;
    group.add(breadMesh);

    // 3. Cheese Wedge
    const cheeseGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16, 1, false, 0, Math.PI/3); // 60 deg wedge
    const cheeseMesh = new THREE.Mesh(cheeseGeo, cheeseMat);
    cheeseMesh.position.set(0.3, plateHeight/2 + 0.1, 0.3);
    cheeseMesh.castShadow = true;
    cheeseMesh.receiveShadow = true;
    group.add(cheeseMesh);

    // Position
    // Table Top -2.75.
    // Plate Height 0.1. Center at -2.75 + 0.05 = -2.7.
    // Place near Tankard.
    group.position.set(7.5, -2.7, 5.5);
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    const shape = new ammo.btCylinderShape(new ammo.btVector3(plateRadius, plateHeight/2, plateRadius));
    createStaticBody(physicsWorld, group, shape);
}
