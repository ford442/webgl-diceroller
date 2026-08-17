import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createWritingSet(
    scene,
    physicsWorld,
    position = { x: 4, y: -2.75, z: 4 },
    rotation = -Math.PI / 6
) {
    let inkSurface;

    return createProp(scene, physicsWorld, {
        name: 'WritingSet',
        position,
        rotation,
        colliders: [
            {
                type: 'cylinder',
                radius: 0.4,
                halfHeight: 0.5,
            },
            {
                type: 'box',
                halfExtents: [1.0, 0.01, 0.75],
                offset: { x: -0.3, z: -0.8 },
                rotation: { y: 0.1 },
            },
            {
                type: 'box',
                halfExtents: [0.2, 0.1, 0.4],
                offset: { x: 1.0, y: 0.1, z: 0.8 },
                rotation: { x: Math.PI / 2, y: Math.PI / 4 },
            },
        ],
        build({ group }) {
            const featherMat = new THREE.MeshStandardMaterial({
                color: 0xf5f5f5,
                roughness: 0.6,
                metalness: 0.0,
                side: THREE.DoubleSide,
            });

            const goldMat = new THREE.MeshStandardMaterial({
                color: 0xffd700,
                roughness: 0.3,
                metalness: 0.8,
            });

            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0x88ccff,
                metalness: 0,
                roughness: 0.05,
                transmission: 0.9,
                thickness: 0.5,
                transparent: true,
                ior: 1.5,
            });

            const inkMat = new THREE.MeshPhysicalMaterial({
                color: 0x1a0a2e,
                metalness: 0.2,
                roughness: 0.1,
                transmission: 0.3,
                transparent: true,
            });

            const parchmentMat = new THREE.MeshStandardMaterial({
                color: 0xf5deb3,
                roughness: 0.9,
                metalness: 0.0,
            });

            const waxMat = new THREE.MeshStandardMaterial({
                color: 0x8b0000,
                roughness: 0.3,
                metalness: 0.1,
            });

            const woodMat = new THREE.MeshStandardMaterial({
                color: 0x5c4033,
                roughness: 0.8,
                metalness: 0.0,
            });

            const inkwellGroup = new THREE.Group();
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
            inkSurface = ink;

            const rimGeo = new THREE.TorusGeometry(0.28, 0.04, 8, 16);
            const rim = new THREE.Mesh(rimGeo, goldMat);
            rim.rotation.x = Math.PI / 2;
            rim.position.y = 1.0;
            rim.castShadow = true;
            inkwellGroup.add(rim);

            const lidGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16);
            const lid = new THREE.Mesh(lidGeo, goldMat);
            lid.position.set(0.7, 0.04, 0.3);
            lid.castShadow = true;
            lid.receiveShadow = true;
            inkwellGroup.add(lid);

            const lidHandleGeo = new THREE.SphereGeometry(0.08, 12, 12);
            const lidHandle = new THREE.Mesh(lidHandleGeo, goldMat);
            lidHandle.position.set(0.7, 0.12, 0.3);
            inkwellGroup.add(lidHandle);

            group.add(inkwellGroup);

            const quillGroup = new THREE.Group();
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
                bevelSegments: 2,
            };
            const featherGeo = new THREE.ExtrudeGeometry(featherShape, featherExtrudeSettings);
            const feather = new THREE.Mesh(featherGeo, featherMat);
            feather.castShadow = true;
            feather.receiveShadow = true;

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
            quillGroup.position.set(-0.4, 0.1, 0.3);
            quillGroup.rotation.set(-Math.PI / 6, 0, -Math.PI / 8);
            group.add(quillGroup);

            const parchmentGroup = new THREE.Group();
            const paperGeo = new THREE.BoxGeometry(2.0, 0.01, 1.5);
            const paper1 = new THREE.Mesh(paperGeo, parchmentMat);
            paper1.position.set(-0.3, 0.005, -0.8);
            paper1.rotation.y = 0.1;
            paper1.castShadow = true;
            paper1.receiveShadow = true;
            parchmentGroup.add(paper1);

            const paper2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.01, 1.2), parchmentMat);
            paper2.position.set(0.5, 0.005, -0.5);
            paper2.rotation.y = -0.2;
            paper2.castShadow = true;
            paper2.receiveShadow = true;
            parchmentGroup.add(paper2);

            const scrap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.008, 0.5), parchmentMat);
            scrap.position.set(0.8, 0.004, 0.3);
            scrap.rotation.y = 0.5;
            scrap.castShadow = true;
            scrap.receiveShadow = true;
            parchmentGroup.add(scrap);

            group.add(parchmentGroup);

            const stampGroup = new THREE.Group();
            const handleGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.6, 12);
            const handle = new THREE.Mesh(handleGeo, woodMat);
            handle.position.y = 0.3;
            handle.castShadow = true;
            stampGroup.add(handle);

            const stampBaseGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.1, 12);
            const stampBase = new THREE.Mesh(stampBaseGeo, goldMat);
            stampBase.position.y = 0.05;
            stampBase.castShadow = true;
            stampGroup.add(stampBase);

            const sealDesignGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.02, 12);
            const sealDesign = new THREE.Mesh(sealDesignGeo, waxMat);
            stampGroup.add(sealDesign);

            stampGroup.position.set(1.0, 0.1, 0.8);
            stampGroup.rotation.z = Math.PI / 2;
            stampGroup.rotation.y = Math.PI / 4;
            group.add(stampGroup);

            const usedSealGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16);
            const usedSeal = new THREE.Mesh(usedSealGeo, waxMat);
            usedSeal.position.set(-0.8, 0.015, 0.2);
            usedSeal.rotation.y = Math.random() * Math.PI;
            usedSeal.receiveShadow = true;
            group.add(usedSeal);
        },
        update(time) {
            const positions = inkSurface.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i);
                const z = positions.getZ(i);
                const dist = Math.sqrt(x * x + z * z);
                const ripple = Math.sin(dist * 10 - time * 2) * 0.005 * Math.max(0, 1 - dist * 2);
                positions.setY(i, positions.getY(i) + ripple * 0.1);
            }
            positions.needsUpdate = true;
        },
    });
}
