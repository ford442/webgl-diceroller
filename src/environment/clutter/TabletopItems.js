import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../../physics.js';
import { TABLETOP_Y_OFFSET } from '../../core/SceneMetrics.js';
import { resolvePlacement } from './ClutterPlacement.js';

const tabletopY = (y) => y + TABLETOP_Y_OFFSET;
const randomUnit = (options) => (options?.rng ?? Math.random)();

export function createMug(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const mugGroup = new THREE.Group();

    // Cup body
    const bodyGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    const material = new THREE.MeshStandardMaterial({
        color: 0x4a3c31,
        roughness: 0.3,
        metalness: 0.05,
        envMapIntensity: 0.8
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    mugGroup.add(bodyMesh);

    // Handle (Torus)
    const handleGeo = new THREE.TorusGeometry(0.3, 0.08, 16, 32);
    const handleMesh = new THREE.Mesh(handleGeo, material);
    handleMesh.position.set(0.5, 0, 0);
    handleMesh.rotation.set(0, Math.PI / 2, 0);
    handleMesh.castShadow = true;
    mugGroup.add(handleMesh);

    // Inner shadow (darkened inside)
    const innerGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.9, 32);
    const innerMat = new THREE.MeshStandardMaterial({
        color: 0x2a1c11,
        roughness: 0.9,
        metalness: 0.0
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.position.y = 0.05;
    mugGroup.add(innerMesh);

    const placement = resolvePlacement(options, { x: 5, z: 5 });
    mugGroup.position.set(placement.x, tabletopY(-2.25), placement.z);
    mugGroup.rotation.y = placement.rotationY;
    scene.add(mugGroup);
    options.track?.(mugGroup);

    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(0.5, 0.5, 0.5));
        createStaticBody(physicsWorld, mugGroup, shape);
    }
}

export function createCoins(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const radius = 0.3;
    const thickness = 0.05;
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 32);

    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 1.0,
        roughness: 0.25,
        envMapIntensity: 1.2
    });

    const silverMaterial = new THREE.MeshStandardMaterial({
        color: 0xc0c0c0,
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.0
    });

    const copperMaterial = new THREE.MeshStandardMaterial({
        color: 0xb87333,
        metalness: 0.95,
        roughness: 0.35,
        envMapIntensity: 0.9
    });

    // The coin colours (gold/silver/copper) are baked into per-instance colours,
    // so all 15 coins render as a single InstancedMesh (one draw call) sharing one
    // metallic material instead of 15 separate meshes.
    const coinColors = [
        new THREE.Color(0xffd700), // gold
        new THREE.Color(0xc0c0c0), // silver
        new THREE.Color(0xb87333)  // copper
    ];
    const instanceMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.1
    });
    // Dispose the now-unused per-colour materials kept for backwards reference.
    goldMaterial.dispose();
    silverMaterial.dispose();
    copperMaterial.dispose();

    const count = 15;
    const placement = resolvePlacement(options, { x: -4, z: 3 });
    const centerX = placement.x;
    const centerZ = placement.z;
    const baseY = tabletopY(-2.75);

    const coins = new THREE.InstancedMesh(geometry, instanceMaterial, count);
    coins.castShadow = true;
    coins.receiveShadow = true;
    coins.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, thickness / 2, radius));
        // Track the per-coin static bodies so disposeObject3D can free them on reroll.
        coins.userData.physicsBodies = [];
    
        for (let i = 0; i < count; i++) {
            // Preserve the original per-coin random sequence for seeded reproducibility.
            coins.setColorAt(i, coinColors[Math.floor(randomUnit(options) * coinColors.length)]);
    
            const angle = randomUnit(options) * Math.PI * 2;
            const dist = randomUnit(options) * 1.5;
            const x = centerX + Math.cos(angle) * dist;
            const z = centerZ + Math.sin(angle) * dist;
    
            let y = baseY + thickness / 2;
            if (i > 5) y += thickness;
            if (i > 10) y += thickness;
    
            dummy.position.set(x, y, z);
            dummy.rotation.set(0, randomUnit(options) * Math.PI * 2, 0);
    
            if (randomUnit(options) > 0.8) {
                dummy.rotation.x = (randomUnit(options) - 0.5) * 0.5;
                dummy.rotation.z = (randomUnit(options) - 0.5) * 0.5;
                dummy.position.y += 0.05;
            }
    
            dummy.updateMatrix();
            coins.setMatrixAt(i, dummy.matrix);
    
            // One static physics body per coin (cheap; matches prior collision feel).
            coins.userData.physicsBodies.push(createStaticBody(physicsWorld, dummy, shape));
    }
    }

    coins.instanceMatrix.needsUpdate = true;
    if (coins.instanceColor) coins.instanceColor.needsUpdate = true;

    scene.add(coins);
    options.track?.(coins);
}

export function createBook(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const width = 3;
    const height = 0.5;
    const depth = 4;
    const geometry = new THREE.BoxGeometry(width, height, depth);

    const material = new THREE.MeshStandardMaterial({
        color: 0x8b0000,
        roughness: 0.7,
        metalness: 0.1,
        bumpScale: 0.02
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const placement = resolvePlacement(options, { x: -6, z: -6 });
    mesh.position.set(placement.x, tabletopY(-2.5), placement.z);
    mesh.rotation.y = options.placement ? placement.rotationY : 0.2;
    scene.add(mesh);
    options.track?.(mesh);

    if (ammo && physicsWorld) {
        const shape = new ammo.btBoxShape(new ammo.btVector3(width / 2, height / 2, depth / 2));
        createStaticBody(physicsWorld, mesh, shape);
    }
}

export function createMiniature(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'MiniaturePawn';

    const material = new THREE.MeshStandardMaterial({
        color: 0x8c92ac,
        roughness: 0.5,
        metalness: 0.85,
        envMapIntensity: 1.0
    });

    const baseRadius = 0.4;
    const baseHeight = 0.1;
    const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 16);
    const baseMesh = new THREE.Mesh(baseGeo, material);
    baseMesh.position.y = baseHeight / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    const bodyHeight = 0.8;
    const bodyRadiusBottom = 0.3;
    const bodyRadiusTop = 0.15;
    const bodyGeo = new THREE.CylinderGeometry(bodyRadiusTop, bodyRadiusBottom, bodyHeight, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, material);
    bodyMesh.position.y = baseHeight + bodyHeight / 2;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    const headRadius = 0.25;
    const headGeo = new THREE.SphereGeometry(headRadius, 16, 16);
    const headMesh = new THREE.Mesh(headGeo, material);
    headMesh.position.y = baseHeight + bodyHeight + headRadius;
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    group.add(headMesh);

    const totalHeight = baseHeight + bodyHeight + headRadius * 2;

    const placement = resolvePlacement(options, { x: -2, z: 2 });
    group.position.set(placement.x, tabletopY(-2.75) + totalHeight / 2, placement.z);
    group.rotation.y = placement.rotationY;

    baseMesh.position.y -= totalHeight / 2;
    bodyMesh.position.y -= totalHeight / 2;
    headMesh.position.y -= totalHeight / 2;

    scene.add(group);
    options.track?.(group);

    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(baseRadius, totalHeight / 2, baseRadius));
        createStaticBody(physicsWorld, group, shape);
    }
}

export function createD20Holder(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const holderGroup = new THREE.Group();

    const material = new THREE.MeshStandardMaterial({
        color: 0x3f1f1f,
        roughness: 0.3,
        metalness: 0.15,
        envMapIntensity: 0.6
    });

    const radius = 0.8;
    const height = 0.4;
    const baseGeo = new THREE.CylinderGeometry(radius, radius, height, 6);
    const baseMesh = new THREE.Mesh(baseGeo, material);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    holderGroup.add(baseMesh);

    const indGeo = new THREE.CircleGeometry(0.5, 32);
    const indMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const indMesh = new THREE.Mesh(indGeo, indMat);
    indMesh.rotation.x = -Math.PI / 2;
    indMesh.position.y = height / 2 + 0.001;
    holderGroup.add(indMesh);

    const placement = resolvePlacement(options, { x: -2, z: -4 });
    holderGroup.position.set(placement.x, tabletopY(-2.55), placement.z);
    holderGroup.rotation.y = placement.rotationY;
    scene.add(holderGroup);
    options.track?.(holderGroup);

    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height / 2, radius));
        createStaticBody(physicsWorld, holderGroup, shape);
    }
}

export function createGemstone(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'RubyGem';

    const radius = 0.5;
    const geometry = new THREE.OctahedronGeometry(radius, 0);

    const material = new THREE.MeshPhysicalMaterial({
        color: 0xff0000,
        emissive: 0x330000,
        emissiveIntensity: 0.2,
        metalness: 0.1,
        roughness: 0.0,
        transmission: 0.8,
        thickness: 0.5,
        ior: 1.76,
        clearcoat: 1.0,
        clearcoatRoughness: 0.0,
        transparent: true
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const placement = resolvePlacement(options, { x: -5, z: 0 });
    group.position.set(placement.x, tabletopY(-2.25), placement.z);
    const rng = options.rng ?? Math.random;
    group.rotation.set(rng(), rng(), rng());
    scene.add(group);
    options.track?.(group);

    if (ammo && physicsWorld) {
        const shape = new ammo.btSphereShape(radius * 0.8);
        createStaticBody(physicsWorld, group, shape);
    }
}

export function createPotionBottle(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const bottleGroup = new THREE.Group();
    bottleGroup.name = 'PotionBottle';

    const points = [];
    for (let i = 0; i <= 10; i++) {
        const angle = (Math.PI / 2) * (i / 10);
        points.push(new THREE.Vector2(Math.sin(angle) * 0.6, -Math.cos(angle) * 0.6));
    }
    points.push(new THREE.Vector2(0.2, 0.2));
    points.push(new THREE.Vector2(0.2, 0.8));
    points.push(new THREE.Vector2(0.25, 0.8));
    points.push(new THREE.Vector2(0.25, 0.9));
    points.push(new THREE.Vector2(0.15, 0.9));

    const bottleGeo = new THREE.LatheGeometry(points, 16);

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.1,
        transmission: 0.9,
        thickness: 0.5,
        ior: 1.5,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide
    });

    const bottleMesh = new THREE.Mesh(bottleGeo, glassMat);
    bottleMesh.castShadow = true;
    bottleMesh.receiveShadow = true;
    bottleGroup.add(bottleMesh);

    const liquidPoints = [];
    for (let i = 0; i <= 8; i++) {
        const angle = (Math.PI / 2) * (i / 10);
        liquidPoints.push(new THREE.Vector2(Math.sin(angle) * 0.55, -Math.cos(angle) * 0.55));
    }
    liquidPoints.push(new THREE.Vector2(0, -Math.cos((Math.PI / 2) * 0.8) * 0.55));

    const liquidGeo = new THREE.LatheGeometry(liquidPoints, 16);
    const liquidMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000,
        emissive: 0x330000,
        metalness: 0.1,
        roughness: 0.2,
        transmission: 0.6,
        transparent: true
    });
    const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
    bottleGroup.add(liquidMesh);

    const corkGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.3, 16);
    const corkMat = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.9,
        metalness: 0.0
    });
    const corkMesh = new THREE.Mesh(corkGeo, corkMat);
    corkMesh.position.y = 0.85;
    bottleMesh.add(corkMesh);

    const placement = resolvePlacement(options, { x: 6, z: -2 });
    bottleGroup.position.set(placement.x, tabletopY(-2.15), placement.z);
    bottleGroup.rotation.y = placement.rotationY;
    scene.add(bottleGroup);
    options.track?.(bottleGroup);

    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(0.6, 0.8, 0.6));
        createStaticBody(physicsWorld, bottleGroup, shape);
    }
}

export function createPencil(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const pencilGroup = new THREE.Group();

    const radius = 0.04;
    const bodyLen = 1.2;
    const ferruleLen = 0.15;
    const eraserLen = 0.15;
    const tipLen = 0.25;

    const yellowMat = new THREE.MeshStandardMaterial({
        color: 0xffbd2e,
        roughness: 0.5,
        metalness: 0.0
    });
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0xd2b48c,
        roughness: 0.7,
        metalness: 0.0
    });
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0xc0c0c0,
        metalness: 0.9,
        roughness: 0.15,
        envMapIntensity: 1.0
    });
    const pinkMat = new THREE.MeshStandardMaterial({
        color: 0xff69b4,
        roughness: 0.8,
        metalness: 0.0
    });
    const blackMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.9,
        metalness: 0.0
    });

    const bodyGeo = new THREE.CylinderGeometry(radius, radius, bodyLen, 6);
    const bodyMesh = new THREE.Mesh(bodyGeo, yellowMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    pencilGroup.add(bodyMesh);

    const ferruleGeo = new THREE.CylinderGeometry(radius, radius, ferruleLen, 32);
    const ferruleMesh = new THREE.Mesh(ferruleGeo, metalMat);
    ferruleMesh.castShadow = true;
    ferruleMesh.receiveShadow = true;
    ferruleMesh.position.y = bodyLen / 2 + ferruleLen / 2;
    pencilGroup.add(ferruleMesh);

    const eraserGeo = new THREE.CylinderGeometry(radius, radius, eraserLen, 32);
    const eraserMesh = new THREE.Mesh(eraserGeo, pinkMat);
    eraserMesh.castShadow = true;
    eraserMesh.receiveShadow = true;
    eraserMesh.position.y = bodyLen / 2 + ferruleLen + eraserLen / 2;
    pencilGroup.add(eraserMesh);

    const tipGeo = new THREE.CylinderGeometry(radius, 0.015, tipLen, 6);
    const tipMesh = new THREE.Mesh(tipGeo, woodMat);
    tipMesh.castShadow = true;
    tipMesh.receiveShadow = true;
    tipMesh.position.y = -(bodyLen / 2 + tipLen / 2);
    pencilGroup.add(tipMesh);

    const leadLen = 0.05;
    const leadGeo = new THREE.CylinderGeometry(0.015, 0, leadLen, 6);
    const leadMesh = new THREE.Mesh(leadGeo, blackMat);
    leadMesh.castShadow = true;
    leadMesh.receiveShadow = true;
    leadMesh.position.y = -(bodyLen / 2 + tipLen + leadLen / 2);
    pencilGroup.add(leadMesh);

    const placement = resolvePlacement(options, { x: 0, z: 4.5 });
    pencilGroup.position.set(placement.x, tabletopY(-2.71), placement.z);
    pencilGroup.rotation.set(0, placement.rotationY, Math.PI / 2, 'YXZ');

    scene.add(pencilGroup);
    options.track?.(pencilGroup);

    const totalLen = bodyLen + ferruleLen + eraserLen + tipLen + leadLen;
    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, totalLen / 2, radius));
        createStaticBody(physicsWorld, pencilGroup, shape);
    }
}
