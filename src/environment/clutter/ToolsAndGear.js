import * as THREE from 'three';
import { createStaticCollider } from '../../core/StaticColliderBridge.js';
import { createFire } from '../Fire.js';
import { TABLETOP_Y_OFFSET } from '../../core/SceneMetrics.js';
import { getWaxMaterial, getWickMaterial, getPaperMaterial } from '../../core/MaterialPalette.js';
import { resolvePlacement } from './ClutterPlacement.js';

const tabletopY = (y) => y + TABLETOP_Y_OFFSET;
const randomUnit = (options) => (options?.rng ?? Math.random)();

function addCylinderCollider(physicsWorld, anchor, radius, halfHeight) {
    createStaticCollider(physicsWorld, anchor, { type: 'cylinder', radius, halfHeight });
}

export function createCandle(scene, physicsWorld, options = {}) {
    const candleGroup = new THREE.Group();

    const radius = 0.4;
    const height = 1.5;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);

    const waxMaterial = getWaxMaterial();

    const candleMesh = new THREE.Mesh(geometry, waxMaterial);
    candleMesh.castShadow = true;
    candleMesh.receiveShadow = true;
    candleGroup.add(candleMesh);

    const dripCount = 5;
    const dripGeo = new THREE.CapsuleGeometry(0.06, 0.35, 4, 8);
    const drips = new THREE.InstancedMesh(dripGeo, waxMaterial, dripCount);
    drips.castShadow = true;
    drips.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dripDummy = new THREE.Object3D();
    for (let i = 0; i < dripCount; i++) {
        const angle = (i / dripCount) * Math.PI * 2 + randomUnit(options) * 0.5;
        const dripHeight = 0.3 + randomUnit(options) * 0.4;
        dripDummy.scale.set(1, dripHeight / 0.35, 1);

        const dripX = Math.cos(angle) * (radius - 0.02);
        const dripZ = Math.sin(angle) * (radius - 0.02);
        dripDummy.position.set(dripX, height / 2 - dripHeight / 2 - 0.1, dripZ);
        dripDummy.rotation.set(Math.cos(angle) * 0.2, 0, -Math.sin(angle) * 0.2);
        dripDummy.updateMatrix();
        drips.setMatrixAt(i, dripDummy.matrix);
    }
    drips.instanceMatrix.needsUpdate = true;
    candleMesh.add(drips);

    const puddleGeo = new THREE.CylinderGeometry(radius + 0.15, radius + 0.1, 0.03, 32);
    const puddle = new THREE.Mesh(puddleGeo, waxMaterial);
    puddle.position.y = -height / 2 - 0.015;
    puddle.scale.y = 0.5;
    candleMesh.add(puddle);

    const wickHeight = 0.2;
    const wickGeo = new THREE.CylinderGeometry(0.04, 0.04, wickHeight, 8);
    const wickMat = getWickMaterial();
    const wickMesh = new THREE.Mesh(wickGeo, wickMat);
    wickMesh.position.set(0, height / 2 + wickHeight / 2, 0);
    candleMesh.add(wickMesh);

    const fire = createFire({
        scale: 0.5,
        color: 0xffaa00,
        particleCount: 25,
        spread: 0.1,
    });
    fire.mesh.position.set(0, height / 2 + wickHeight + 0.05, 0);
    candleMesh.add(fire.mesh);

    const posX = -2;
    const posZ = -6;
    const posY = tabletopY(-2.0);

    candleGroup.position.set(posX, posY, posZ);
    scene.add(candleGroup);
    options.track?.(candleGroup);

    addCylinderCollider(physicsWorld, candleGroup, radius, height / 2);

    const flameWorldPos = new THREE.Vector3(posX, posY + height / 2 + wickHeight + 0.05, posZ);

    const flameLight = new THREE.PointLight(0xff6600, 1, 8);
    flameLight.position.copy(fire.mesh.position);
    flameLight.position.y += 0.1;
    candleMesh.add(flameLight);

    function update(deltaTime, time) {
        fire.update(deltaTime);

        const breathing = Math.sin(time * 1.5) * 0.15;
        const flicker = Math.sin(time * 8) * 0.1;
        const jitter = (Math.random() - 0.5) * 0.2;

        const intensity = 1.0 + breathing + flicker + jitter;
        flameLight.intensity = Math.max(0.5, intensity);

        const hueShift = Math.sin(time * 3) * 0.05;
        flameLight.color.setHSL(0.08 + hueShift, 1.0, 0.5);

        const flameScale = 0.5 + (intensity - 1.0) * 0.1;
        fire.mesh.scale.setScalar(flameScale);

        wickMat.emissiveIntensity = 0.3 + (intensity - 1.0) * 0.2;
    }

    return {
        flamePosition: flameWorldPos,
        update: update,
        group: candleGroup,
    };
}

export function createQuill(scene, physicsWorld, options = {}) {
    const group = new THREE.Group();
    group.name = 'Quill';

    const potHeight = 0.4;
    const potRadiusTop = 0.25;
    const potRadiusBot = 0.3;

    const potMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.3,
        metalness: 0.4,
        envMapIntensity: 0.8,
    });

    const potGeo = new THREE.CylinderGeometry(potRadiusTop, potRadiusBot, potHeight, 16);
    const potMesh = new THREE.Mesh(potGeo, potMat);
    potMesh.castShadow = true;
    potMesh.receiveShadow = true;
    group.add(potMesh);

    const inkGeo = new THREE.CircleGeometry(potRadiusTop - 0.02, 16);
    const inkMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        roughness: 0.1,
        metalness: 0.3,
        envMapIntensity: 0.5,
    });
    const inkMesh = new THREE.Mesh(inkGeo, inkMat);
    inkMesh.rotation.x = -Math.PI / 2;
    inkMesh.position.y = potHeight / 2 + 0.001;
    group.add(inkMesh);

    const quillGroup = new THREE.Group();

    const shaftLen = 1.2;
    const shaftGeo = new THREE.CylinderGeometry(0.02, 0.01, shaftLen, 8);
    const shaftMat = getPaperMaterial();
    const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    shaftMesh.castShadow = true;
    shaftMesh.position.y = shaftLen / 2;
    quillGroup.add(shaftMesh);

    const featherShape = new THREE.Shape();
    featherShape.moveTo(0, 0);
    featherShape.quadraticCurveTo(0.15, 0.3, 0.15, 0.9);
    featherShape.quadraticCurveTo(0.1, 1.1, 0, 1.2);
    featherShape.quadraticCurveTo(-0.1, 1.1, -0.15, 0.9);
    featherShape.quadraticCurveTo(-0.15, 0.3, 0, 0);

    const featherGeo = new THREE.ShapeGeometry(featherShape);
    const featherMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.8,
        side: THREE.DoubleSide,
    });
    const featherMesh = new THREE.Mesh(featherGeo, featherMat);
    featherMesh.castShadow = true;
    featherMesh.receiveShadow = true;
    featherMesh.position.y = 0.2;
    quillGroup.add(featherMesh);

    quillGroup.rotation.z = -Math.PI / 6 - randomUnit(options) * 0.1;
    quillGroup.rotation.y = randomUnit(options) * Math.PI * 2;
    quillGroup.position.set(0, potHeight / 2 - 0.1, 0);

    group.add(quillGroup);

    const placement = resolvePlacement(options, { x: 5.5, z: -2.0 });
    group.position.set(placement.x, tabletopY(-2.55), placement.z);
    if (options.placement) {
        group.rotation.y = placement.rotationY;
    }
    scene.add(group);
    options.track?.(group);

    addCylinderCollider(physicsWorld, group, potRadiusBot, potHeight / 2);
}
