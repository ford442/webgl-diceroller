import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createPotionSet(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'PotionSet';

    // Materials
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.8,
        bumpScale: 0.1
    });

    // Glass Material (Base)
    const glassMatBase = {
        metalness: 0,
        roughness: 0.1,
        transmission: 0.95,
        thickness: 0.1,
        transparent: true,
        side: THREE.DoubleSide
    };

    // --- 1. The Stand ---
    // Simple 2-step stand
    const stepWidth = 4;
    const stepDepth = 1.5;
    const stepHeight = 0.5;

    // Bottom Step
    const botStepGeo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth * 2);
    const botStep = new THREE.Mesh(botStepGeo, woodMat);
    botStep.position.y = stepHeight / 2;
    botStep.castShadow = true;
    botStep.receiveShadow = true;
    group.add(botStep);

    // Top Step (Back half)
    const topStepGeo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
    const topStep = new THREE.Mesh(topStepGeo, woodMat);
    topStep.position.set(0, stepHeight + stepHeight / 2, -stepDepth / 2);
    topStep.castShadow = true;
    topStep.receiveShadow = true;
    group.add(topStep);

    // Physics for Stand (Compound or Simple Box)
    // Box 1: Bottom full width/depth.
    const botShape = new ammo.btBoxShape(new ammo.btVector3(stepWidth/2, stepHeight/2, stepDepth));

    // Box 2: Top step.
    const topShape = new ammo.btBoxShape(new ammo.btVector3(stepWidth/2, stepHeight/2, stepDepth/2));

    // --- 2. Potions ---

    // Potion A: Health (Red, Round) - On Top Step
    const healthPotion = createRoundPotion(0xff0000);
    healthPotion.position.set(-1.0, stepHeight * 2, -0.5);
    group.add(healthPotion);

    // Potion B: Mana (Blue, Square) - On Top Step
    const manaPotion = createSquarePotion(0x0000ff);
    manaPotion.position.set(1.0, stepHeight * 2, -0.5);
    group.add(manaPotion);

    // Potion C: Stamina (Green, Conical) - On Bottom Step
    const staminaPotion = createConicalPotion(0x00ff00);
    staminaPotion.position.set(0, stepHeight, 0.8);
    group.add(staminaPotion);


    // --- Positioning the Group ---
    // Table Top Y = -2.75.
    // We want the bottom of the stand (y=0 local) to be at -2.75.
    // Stand is at (8, -2.75, 0).
    group.position.set(8, -2.75, 0);
    // Slight rotation
    group.rotation.y = -Math.PI / 6; // Angle towards center

    scene.add(group);

    // --- Physics Creation (Now that Group is placed) ---

    function addBodyForMesh(mesh, shape, offsetY = 0) {
        const worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);
        const worldQuat = new THREE.Quaternion();
        mesh.getWorldQuaternion(worldQuat);

        const dummy = new THREE.Object3D();
        dummy.position.copy(worldPos);
        dummy.quaternion.copy(worldQuat);

        // Apply local vertical offset (e.g. for objects built from y=0 up)
        if (offsetY !== 0) {
            dummy.translateY(offsetY);
        }

        createStaticBody(physicsWorld, dummy, shape);
    }

    // Stand Bodies (Box geometries are centered, no offset needed)
    addBodyForMesh(botStep, botShape);
    addBodyForMesh(topStep, topShape);

    // Potion Bodies (Meshes are built from y=0 up, shapes are centered)
    // Health (Sphere approx, radius 0.4) -> Center at 0.4
    const healthShape = new ammo.btSphereShape(0.4);
    addBodyForMesh(healthPotion, healthShape, 0.4);

    // Mana (Box approx, height 1.0) -> Center at 0.5
    const manaShape = new ammo.btBoxShape(new ammo.btVector3(0.3, 0.5, 0.3));
    addBodyForMesh(manaPotion, manaShape, 0.5);

    // Stamina (Cylinder approx, height ~1.0) -> Center at 0.5
    const staminaShape = new ammo.btCylinderShape(new ammo.btVector3(0.3, 0.5, 0.3));
    addBodyForMesh(staminaPotion, staminaShape, 0.5);
}

function createRoundPotion(color) {
    const group = new THREE.Group();

    // Flask
    const points = [];
    for (let i = 0; i <= 10; i++) {
        const angle = (Math.PI / 2) * (i / 10);
        points.push(new THREE.Vector2(Math.sin(angle) * 0.4, -Math.cos(angle) * 0.4 + 0.4)); // Radius 0.4, shifted up
    }
    points.push(new THREE.Vector2(0.15, 0.8)); // Neck
    points.push(new THREE.Vector2(0.2, 0.85)); // Rim

    const geo = new THREE.LatheGeometry(points, 16);
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.1,
        transmission: 0.9,
        thickness: 0.1,
        transparent: true
    });
    const flask = new THREE.Mesh(geo, mat);
    flask.castShadow = true;
    flask.receiveShadow = true;
    group.add(flask);

    // Liquid
    const liquidGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const liquidMat = new THREE.MeshPhysicalMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.6,
        transparent: true
    });
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = 0.4;
    group.add(liquid);

    // Cork
    const corkGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.2, 16);
    const corkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
    const cork = new THREE.Mesh(corkGeo, corkMat);
    cork.position.y = 0.9;
    group.add(cork);

    return group;
}

function createSquarePotion(color) {
    const group = new THREE.Group();

    // Bottle
    const width = 0.6;
    const height = 1.0;
    const depth = 0.6;
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.1,
        transmission: 0.9,
        thickness: 0.1,
        transparent: true
    });
    const bottle = new THREE.Mesh(geo, mat);
    bottle.position.y = height / 2;
    bottle.castShadow = true;
    bottle.receiveShadow = true;
    group.add(bottle);

    // Liquid
    const liquidGeo = new THREE.BoxGeometry(width - 0.1, height * 0.7, depth - 0.1);
    const liquidMat = new THREE.MeshPhysicalMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        transmission: 0.6,
        transparent: true
    });
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = (height * 0.7) / 2 + 0.05;
    group.add(liquid);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16);
    const neck = new THREE.Mesh(neckGeo, mat);
    neck.position.y = height + 0.15;
    group.add(neck);

    // Cork
    const corkGeo = new THREE.CylinderGeometry(0.14, 0.12, 0.2, 16);
    const corkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const cork = new THREE.Mesh(corkGeo, corkMat);
    cork.position.y = height + 0.35;
    group.add(cork);

    return group;
}

function createConicalPotion(color) {
    const group = new THREE.Group();

    // Flask (Cone)
    const radius = 0.5;
    const height = 1.0;

    // Custom Lathe for better shape
    const points = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.5, 0),
        new THREE.Vector2(0.15, 0.8), // Taper up
        new THREE.Vector2(0.2, 0.9) // Rim
    ];
    const flaskGeo = new THREE.LatheGeometry(points, 16);
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 0.9,
        thickness: 0.1,
        roughness: 0.1,
        transparent: true
    });
    const flask = new THREE.Mesh(flaskGeo, mat);
    flask.castShadow = true;
    flask.receiveShadow = true;
    group.add(flask);

    // Liquid
    const liquidPoints = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.45, 0),
        new THREE.Vector2(0.2, 0.6)
    ];
    const liquidGeo = new THREE.LatheGeometry(liquidPoints, 16);
    const liquidMat = new THREE.MeshPhysicalMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        transmission: 0.6,
        transparent: true
    });
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = 0.05;
    group.add(liquid);

    // Cork
    const corkGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.2, 16);
    const corkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const cork = new THREE.Mesh(corkGeo, corkMat);
    cork.position.y = 0.9;
    group.add(cork);

    return group;
}
