import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../../physics.js';
import { createFire } from '../Fire.js';
import { TABLETOP_Y_OFFSET } from '../../core/SceneMetrics.js';
import {
    getWaxMaterial,
    getWickMaterial,
    getWroughtIronMaterial,
    getDarkLeatherMaterial,
    getBlackAccentMaterial,
    getBrassMaterial,
    getPaperMaterial
} from '../../core/MaterialPalette.js';
import { resolvePlacement } from './ClutterPlacement.js';

const tabletopY = (y) => y + TABLETOP_Y_OFFSET;
const randomUnit = (options) => (options?.rng ?? Math.random)();

export function createCandle(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
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
        spread: 0.1
    });
    fire.mesh.position.set(0, height / 2 + wickHeight + 0.05, 0);
    candleMesh.add(fire.mesh);

    const posX = -2;
    const posZ = -6;
    const posY = tabletopY(-2.0);

    candleGroup.position.set(posX, posY, posZ);
    scene.add(candleGroup);
    options.track?.(candleGroup);

    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height / 2, radius));
        createStaticBody(physicsWorld, candleGroup, shape);
    }

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
        group: candleGroup
    };
}

export function createKey(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const keyGroup = new THREE.Group();
    keyGroup.name = 'IronKey';

    const material = getWroughtIronMaterial();

    const bowRadius = 0.3;
    const bowTube = 0.06;
    const bowGeo = new THREE.TorusGeometry(bowRadius, bowTube, 8, 16);
    const bowMesh = new THREE.Mesh(bowGeo, material);
    bowMesh.rotation.x = Math.PI / 2;
    bowMesh.castShadow = true;
    bowMesh.receiveShadow = true;
    keyGroup.add(bowMesh);

    const shaftLen = 1.0;
    const shaftRadius = 0.06;
    const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 8);
    const shaftMesh = new THREE.Mesh(shaftGeo, material);
    shaftMesh.rotation.x = Math.PI / 2;
    shaftMesh.position.z = bowRadius + shaftLen / 2 - 0.05;
    shaftMesh.castShadow = true;
    shaftMesh.receiveShadow = true;
    keyGroup.add(shaftMesh);

    const collarGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8);
    const collarMesh = new THREE.Mesh(collarGeo, material);
    collarMesh.rotation.x = Math.PI / 2;
    collarMesh.position.z = bowRadius + 0.2;
    collarMesh.castShadow = true;
    keyGroup.add(collarMesh);

    const bitGeo = new THREE.BoxGeometry(0.3, 0.1, 0.2);
    const bitMesh = new THREE.Mesh(bitGeo, material);
    bitMesh.position.set(shaftRadius + 0.15, 0, bowRadius + shaftLen - 0.2);
    bitMesh.castShadow = true;
    bitMesh.receiveShadow = true;
    keyGroup.add(bitMesh);

    const bit2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), material);
    bit2.position.set(shaftRadius + 0.1, 0, bowRadius + shaftLen - 0.35);
    bit2.castShadow = true;
    bit2.receiveShadow = true;
    keyGroup.add(bit2);

    const placement = resolvePlacement(options, { x: 2, z: -5 });
    keyGroup.position.set(placement.x, tabletopY(-2.69), placement.z);
    keyGroup.rotation.y = placement.rotationY;
    scene.add(keyGroup);
    options.track?.(keyGroup);

    if (ammo && physicsWorld) {
        const shape = new ammo.btBoxShape(new ammo.btVector3(0.3, 0.06, 0.7));
        createStaticBody(physicsWorld, keyGroup, shape);
    }
}

export function createQuill(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Quill';

    const potHeight = 0.4;
    const potRadiusTop = 0.25;
    const potRadiusBot = 0.3;

    const potMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.3,
        metalness: 0.4,
        envMapIntensity: 0.8
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
        envMapIntensity: 0.5
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
        side: THREE.DoubleSide
    });
    const featherMesh = new THREE.Mesh(featherGeo, featherMat);
    featherMesh.castShadow = true;
    featherMesh.receiveShadow = true;
    featherMesh.position.y = 0.2;
    quillGroup.add(featherMesh);

    quillGroup.rotation.z = -Math.PI / 6 - (randomUnit(options) * 0.1);
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

    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(potRadiusBot, potHeight / 2, potRadiusBot));
        createStaticBody(physicsWorld, group, shape);
    }
}

export function createPipe(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'SmokingPipe';

    const woodMat = getDarkLeatherMaterial();
    const blackMat = getBlackAccentMaterial();

    const ashMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 1.0
    });

    const emberMat = new THREE.MeshStandardMaterial({
        color: 0xff4400,
        emissive: 0xff2200,
        emissiveIntensity: 0.5,
        roughness: 1.0
    });

    const points = [];
    points.push(new THREE.Vector2(0, -0.4));
    points.push(new THREE.Vector2(0.25, -0.35));
    points.push(new THREE.Vector2(0.35, -0.1));
    points.push(new THREE.Vector2(0.35, 0.1));
    points.push(new THREE.Vector2(0.25, 0.15));
    points.push(new THREE.Vector2(0.15, 0.15));
    points.push(new THREE.Vector2(0.15, -0.2));
    points.push(new THREE.Vector2(0, -0.2));

    const bowlGeo = new THREE.LatheGeometry(points, 16);
    const bowlMesh = new THREE.Mesh(bowlGeo, woodMat);
    bowlMesh.castShadow = true;
    bowlMesh.receiveShadow = true;
    group.add(bowlMesh);

    const ashGeo = new THREE.CircleGeometry(0.14, 16);
    const ashMesh = new THREE.Mesh(ashGeo, ashMat);
    ashMesh.rotation.x = -Math.PI / 2;
    ashMesh.position.y = 0.1;
    group.add(ashMesh);

    const emberGeo = new THREE.CircleGeometry(0.05, 8);
    const emberMesh = new THREE.Mesh(emberGeo, emberMat);
    emberMesh.rotation.x = -Math.PI / 2;
    emberMesh.position.y = 0.101;
    emberMesh.position.x = 0.04;
    group.add(emberMesh);

    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.3, -0.1, 0),
        new THREE.Vector3(0.6, -0.05, 0),
        new THREE.Vector3(1.0, 0.1, 0),
        new THREE.Vector3(1.5, 0.2, 0)
    ]);

    const stemGeo = new THREE.TubeGeometry(curve, 16, 0.05, 8, false);
    const stemMesh = new THREE.Mesh(stemGeo, woodMat);
    stemMesh.castShadow = true;
    stemMesh.receiveShadow = true;
    group.add(stemMesh);

    const bitGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8);
    const bitMesh = new THREE.Mesh(bitGeo, blackMat);
    bitMesh.rotation.z = -Math.PI / 2 + 0.2;
    bitMesh.scale.z = 0.5;
    bitMesh.position.set(1.7, 0.25, 0);
    bitMesh.castShadow = true;
    bitMesh.receiveShadow = true;
    group.add(bitMesh);

    const placement = resolvePlacement(options, { x: -3.5, z: -5 });
    group.position.set(placement.x, tabletopY(-2.35), placement.z);
    group.rotation.y = options.placement ? placement.rotationY : Math.PI / 3;
    scene.add(group);
    options.track?.(group);

    if (ammo && physicsWorld) {
        const bowlShape = new ammo.btCylinderShape(new ammo.btVector3(0.35, 0.3, 0.35));
        createStaticBody(physicsWorld, group, bowlShape);
    }
}

export function createSpyglass(scene, physicsWorld, options = {}) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Spyglass';

    const brassMat = getBrassMaterial();

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0,
        transmission: 0.9,
        transparent: true
    });

    const leatherMat = getDarkLeatherMaterial();

    const mainLen = 1.5;
    const mainRad = 0.15;
    const mainGeo = new THREE.CylinderGeometry(mainRad, mainRad, mainLen, 16);
    const mainMesh = new THREE.Mesh(mainGeo, leatherMat);
    mainMesh.castShadow = true;
    mainMesh.receiveShadow = true;
    group.add(mainMesh);

    const ringGeo = new THREE.CylinderGeometry(mainRad + 0.01, mainRad + 0.01, 0.1, 16);
    const ring1 = new THREE.Mesh(ringGeo, brassMat);
    ring1.position.y = -mainLen / 2 + 0.05;
    group.add(ring1);

    const ring2 = new THREE.Mesh(ringGeo, brassMat);
    ring2.position.y = mainLen / 2 - 0.05;
    group.add(ring2);

    const drawLen = 1.2;
    const drawRad = 0.12;
    const drawGeo = new THREE.CylinderGeometry(drawRad, drawRad, drawLen, 16);
    const drawMesh = new THREE.Mesh(drawGeo, brassMat);
    drawMesh.position.y = mainLen / 2 + drawLen / 2 - 0.3;
    drawMesh.castShadow = true;
    drawMesh.receiveShadow = true;
    group.add(drawMesh);

    const lensGeo = new THREE.CylinderGeometry(drawRad - 0.01, drawRad - 0.01, 0.02, 16);
    const lensMesh = new THREE.Mesh(lensGeo, glassMat);
    lensMesh.position.y = mainLen / 2 + drawLen - 0.3;
    group.add(lensMesh);

    const eyeRad = 0.08;
    const eyeLen = 0.2;
    const eyeGeo = new THREE.CylinderGeometry(eyeRad, eyeRad, eyeLen, 16);
    const eyeMesh = new THREE.Mesh(eyeGeo, brassMat);
    eyeMesh.position.y = -mainLen / 2 - 0.1;
    group.add(eyeMesh);

    const placement = resolvePlacement(options, { x: 0, z: 6 });
    group.position.set(placement.x, tabletopY(-2.59), placement.z);
    group.rotation.set(0, placement.rotationY, Math.PI / 2, 'YXZ');
    scene.add(group);
    options.track?.(group);

    const totalLen = mainLen + drawLen - 0.3;
    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(mainRad, totalLen / 2, mainRad));
        createStaticBody(physicsWorld, group, shape);
    }
}
