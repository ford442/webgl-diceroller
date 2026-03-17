import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createWritingSet(scene, physicsWorld, position = { x: 4, y: -2.75, z: 4 }, rotation = -Math.PI / 6) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'WritingSet';

    // Materials
    const featherMat = new THREE.MeshStandardMaterial({
        color: 0xf5f5f5,
        roughness: 0.6,
        metalness: 0.0,
        side: THREE.DoubleSide
    });

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        metalness: 0.8
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x88ccff,
        metalness: 0,
        roughness: 0.05,
        transmission: 0.9,
        thickness: 0.5,
        transparent: true,
        ior: 1.5
    });

    const inkMat = new THREE.MeshPhysicalMaterial({
        color: 0x1a0a2e,
        metalness: 0.2,
        roughness: 0.1,
        transmission: 0.3,
        transparent: true
    });

    const parchmentMat = new THREE.MeshStandardMaterial({
        color: 0xf5deb3,
        roughness: 0.9,
        metalness: 0.0
    });

    const waxMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000,
        roughness: 0.3,
        metalness: 0.1
    });

    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.8,
        metalness: 0.0
    });

    // --- Inkwell ---
    const inkwellGroup = new THREE.Group();

    // Inkwell base (glass)
    const basePoints = [];
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const angle = (Math.PI / 2) * t;
        const r = Math.sin(angle) * 0.4 + 0.15;
        const y = -Math.cos(angle) * 0.5 + 0.5;
        basePoints.push(new THREE.Vector2(r, y));
    }
    const inkwellGeo = new THREE.LatheGeometry(basePoints, 16);
    const inkwell = new THREE.Mesh(inkwellGeo, glassMat);
    inkwell.castShadow = true;
    inkwell.receiveShadow = true;
    inkwellGroup.add(inkwell);

    // Ink inside
    const inkPoints = [];
    for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const angle = (Math.PI / 2) * t;
        const r = Math.sin(angle) * 0.32 + 0.1;
        const y = -Math.cos(angle) * 0.35 + 0.35;
        inkPoints.push(new THREE.Vector2(r, y));
    }
    const inkGeo = new THREE.LatheGeometry(inkPoints, 16);
    const ink = new THREE.Mesh(inkGeo, inkMat);
    ink.position.y = 0.05;
    inkwellGroup.add(ink);

    // Inkwell rim (gold)
    const rimGeo = new THREE.TorusGeometry(0.28, 0.04, 8, 16);
    const rim = new THREE.Mesh(rimGeo, goldMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 1.0;
    rim.castShadow = true;
    inkwellGroup.add(rim);

    // Inkwell lid (resting beside)
    const lidGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16);
    const lid = new THREE.Mesh(lidGeo, goldMat);
    lid.position.set(0.7, 0.04, 0.3);
    lid.castShadow = true;
    lid.receiveShadow = true;
    inkwellGroup.add(lid);

    // Lid handle
    const lidHandleGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const lidHandle = new THREE.Mesh(lidHandleGeo, goldMat);
    lidHandle.position.set(0.7, 0.12, 0.3);
    inkwellGroup.add(lidHandle);

    inkwellGroup.position.set(0, 0, 0);
    group.add(inkwellGroup);

    // --- Feather Quill ---
    const quillGroup = new THREE.Group();

    // Feather shape
    const featherShape = new THREE.Shape();
    featherShape.moveTo(0, 0);
    featherShape.quadraticCurveTo(0.15, 0.3, 0.1, 0.8);
    featherShape.quadraticCurveTo(0, 1.2, -0.1, 0.8);
    featherShape.quadraticCurveTo(-0.15, 0.3, 0, 0);

    const featherExtrudeSettings = {
        steps: 2,
        depth: 0.02,
        bevelEnabled: true,
        bevelThickness: 0.01,
        bevelSize: 0.01,
        bevelSegments: 2
    };
    const featherGeo = new THREE.ExtrudeGeometry(featherShape, featherExtrudeSettings);
    const feather = new THREE.Mesh(featherGeo, featherMat);
    feather.castShadow = true;
    feather.receiveShadow = true;

    // Quill shaft
    const shaftCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.1, 0.3, 0),
        new THREE.Vector3(0.05, 0.8, 0)
    );
    const shaftGeo = new THREE.TubeGeometry(shaftCurve, 12, 0.02, 6, false);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.castShadow = true;

    quillGroup.add(feather);
    quillGroup.add(shaft);

    // Position quill resting against inkwell
    quillGroup.position.set(-0.4, 0.1, 0.3);
    quillGroup.rotation.set(-Math.PI / 6, 0, -Math.PI / 8);
    group.add(quillGroup);

    // --- Parchment Papers ---
    const parchmentGroup = new THREE.Group();

    // Main sheet
    const paperGeo = new THREE.BoxGeometry(2.0, 0.01, 1.5);
    const paper1 = new THREE.Mesh(paperGeo, parchmentMat);
    paper1.position.set(-0.3, 0.005, -0.8);
    paper1.rotation.y = 0.1;
    paper1.castShadow = true;
    paper1.receiveShadow = true;
    parchmentGroup.add(paper1);

    // Smaller sheet (partially under)
    const paper2 = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.01, 1.2),
        parchmentMat
    );
    paper2.position.set(0.5, 0.005, -0.5);
    paper2.rotation.y = -0.2;
    paper2.castShadow = true;
    paper2.receiveShadow = true;
    parchmentGroup.add(paper2);

    // Small note scrap
    const scrap = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.008, 0.5),
        parchmentMat
    );
    scrap.position.set(0.8, 0.004, 0.3);
    scrap.rotation.y = 0.5;
    scrap.castShadow = true;
    scrap.receiveShadow = true;
    parchmentGroup.add(scrap);

    parchmentGroup.position.set(0, 0, 0);
    group.add(parchmentGroup);

    // --- Wax Seal Stamp ---
    const stampGroup = new THREE.Group();

    // Stamp handle (wood)
    const handleGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.6, 12);
    const handle = new THREE.Mesh(handleGeo, woodMat);
    handle.position.y = 0.3;
    handle.castShadow = true;
    stampGroup.add(handle);

    // Stamp base (gold)
    const stampBaseGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.1, 12);
    const stampBase = new THREE.Mesh(stampBaseGeo, goldMat);
    stampBase.position.y = 0.05;
    stampBase.castShadow = true;
    stampGroup.add(stampBase);

    // Wax seal design (on bottom)
    const sealDesignGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.02, 12);
    const sealDesign = new THREE.Mesh(sealDesignGeo, waxMat);
    sealDesign.position.y = 0.0;
    stampGroup.add(sealDesign);

    // Resting on its side
    stampGroup.position.set(1.0, 0.1, 0.8);
    stampGroup.rotation.z = Math.PI / 2;
    stampGroup.rotation.y = Math.PI / 4;
    group.add(stampGroup);

    // Loose wax seal (used)
    const usedSealGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16);
    const usedSeal = new THREE.Mesh(usedSealGeo, waxMat);
    usedSeal.position.set(-0.8, 0.015, 0.2);
    usedSeal.rotation.y = Math.random() * Math.PI;
    usedSeal.receiveShadow = true;
    group.add(usedSeal);

    // --- Positioning ---
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotation;
    scene.add(group);

    // --- Ink Ripple Animation ---
    const inkSurface = ink;
    const updateInk = (time) => {
        // Subtle ripple effect on ink surface
        const positions = inkSurface.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const dist = Math.sqrt(x * x + z * z);
            const ripple = Math.sin(dist * 10 - time * 2) * 0.005 * Math.max(0, 1 - dist * 2);
            positions.setY(i, positions.getY(i) + ripple * 0.1);
        }
        positions.needsUpdate = true;
    };

    // --- Physics ---
    // Inkwell physics
    const inkwellShape = new ammo.btCylinderShape(new ammo.btVector3(0.4, 0.5, 0.4));
    const inkwellDummy = new THREE.Object3D();
    inkwellDummy.position.copy(group.position);
    inkwellDummy.quaternion.copy(group.quaternion);
    createStaticBody(physicsWorld, inkwellDummy, inkwellShape);

    // Parchment papers physics (approximated as flat boxes)
    const paperShape = new ammo.btBoxShape(new ammo.btVector3(1.0, 0.01, 0.75));
    const paperDummy = new THREE.Object3D();
    paperDummy.position.copy(group.position).add(new THREE.Vector3(-0.3, 0, -0.8).applyEuler(group.rotation));
    paperDummy.rotation.y = rotation + 0.1;
    createStaticBody(physicsWorld, paperDummy, paperShape);

    // Stamp physics
    const stampShape = new ammo.btBoxShape(new ammo.btVector3(0.2, 0.1, 0.4));
    const stampDummy = new THREE.Object3D();
    stampDummy.position.copy(group.position).add(new THREE.Vector3(1.0, 0.1, 0.8).applyEuler(group.rotation));
    stampDummy.rotation.set(Math.PI / 2, 0, rotation + Math.PI / 4);
    createStaticBody(physicsWorld, stampDummy, stampShape);

    return { group, update: updateInk };
}
