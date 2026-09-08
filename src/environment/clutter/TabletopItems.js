import * as THREE from 'three';
import { createStaticCollider } from '../../core/StaticColliderBridge.js';
import { TABLETOP_Y_OFFSET } from '../../core/SceneMetrics.js';
import {
    getDarkLeatherMaterial,
    getBlackAccentMaterial,
    getDarkRedMaterial,
    getInstancedMetalMaterial,
    getWoodMaterial,
} from '../../core/MaterialPalette.js';
import { resolvePlacement } from './ClutterPlacement.js';

const tabletopY = (y) => y + TABLETOP_Y_OFFSET;
const randomUnit = (options) => (options?.rng ?? Math.random)();

function addBoxCollider(physicsWorld, anchor, halfExtents) {
    createStaticCollider(physicsWorld, anchor, { type: 'box', halfExtents });
}

function addCylinderCollider(physicsWorld, anchor, radius, halfHeight) {
    createStaticCollider(physicsWorld, anchor, { type: 'cylinder', radius, halfHeight });
}

export function createCoins(scene, physicsWorld, options = {}) {
    const radius = 0.3;
    const thickness = 0.05;
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 32);

    // Per-instance colours (gold/silver/copper) share one palette metallic material.
    const coinColors = [
        new THREE.Color(0xffd700),
        new THREE.Color(0xc0c0c0),
        new THREE.Color(0xb87333),
    ];
    const instanceMaterial = getInstancedMetalMaterial();

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
    coins.userData.physicsBodies = [];

    for (let i = 0; i < count; i++) {
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

        const result = createStaticCollider(physicsWorld, dummy, {
            type: 'cylinder',
            radius,
            halfHeight: thickness / 2,
        });
        if (result?.body) coins.userData.physicsBodies.push(result.body);
    }

    coins.instanceMatrix.needsUpdate = true;
    if (coins.instanceColor) coins.instanceColor.needsUpdate = true;

    scene.add(coins);
    options.track?.(coins);
}

export function createBook(scene, physicsWorld, options = {}) {
    const width = 3;
    const height = 0.5;
    const depth = 4;
    const geometry = new THREE.BoxGeometry(width, height, depth);

    const mesh = new THREE.Mesh(geometry, getDarkRedMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const placement = resolvePlacement(options, { x: -6, z: -6 });
    mesh.position.set(placement.x, tabletopY(-2.5), placement.z);
    mesh.rotation.y = options.placement ? placement.rotationY : 0.2;
    scene.add(mesh);
    options.track?.(mesh);

    addBoxCollider(physicsWorld, mesh, [width / 2, height / 2, depth / 2]);
}

export function createD20Holder(scene, physicsWorld, options = {}) {
    const holderGroup = new THREE.Group();

    const material = getDarkLeatherMaterial();

    const radius = 0.8;
    const height = 0.4;
    const baseGeo = new THREE.CylinderGeometry(radius, radius, height, 6);
    const baseMesh = new THREE.Mesh(baseGeo, material);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    holderGroup.add(baseMesh);

    const indGeo = new THREE.CircleGeometry(0.5, 32);
    const indMesh = new THREE.Mesh(indGeo, getBlackAccentMaterial());
    indMesh.rotation.x = -Math.PI / 2;
    indMesh.position.y = height / 2 + 0.001;
    holderGroup.add(indMesh);

    const placement = resolvePlacement(options, { x: -2, z: -4 });
    holderGroup.position.set(placement.x, tabletopY(-2.55), placement.z);
    holderGroup.rotation.y = placement.rotationY;
    scene.add(holderGroup);
    options.track?.(holderGroup);

    addCylinderCollider(physicsWorld, holderGroup, radius, height / 2);
}

export function createGemstone(scene, physicsWorld, options = {}) {
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
        transparent: true,
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

    addBoxCollider(physicsWorld, group, [radius * 0.8, radius * 0.8, radius * 0.8]);
}

export function createPotionBottle(scene, physicsWorld, options = {}) {
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
        side: THREE.DoubleSide,
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
        transparent: true,
    });
    const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
    bottleGroup.add(liquidMesh);

    const corkGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.3, 16);
    const corkMesh = new THREE.Mesh(corkGeo, getWoodMaterial(0x8b4513));
    corkMesh.position.y = 0.85;
    bottleMesh.add(corkMesh);

    const placement = resolvePlacement(options, { x: 6, z: -2 });
    bottleGroup.position.set(placement.x, tabletopY(-2.15), placement.z);
    bottleGroup.rotation.y = placement.rotationY;
    scene.add(bottleGroup);
    options.track?.(bottleGroup);

    addCylinderCollider(physicsWorld, bottleGroup, 0.6, 0.8);
}
