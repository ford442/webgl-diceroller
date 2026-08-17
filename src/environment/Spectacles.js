import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createSpectacles(
    scene,
    physicsWorld,
    position = { x: 6, y: -2.75, z: -4 },
    rotationY = 0
) {
    const lensRadius = 0.2;
    const lensThick = 0.01;
    const frameTube = 0.015;
    const bridgeWidth = 0.15;
    const armLen = 0.5;

    createProp(scene, physicsWorld, {
        name: 'Spectacles',
        position,
        rotation: rotationY,
        footOffsetY: frameTube,
        colliders: [
            {
                type: 'box',
                halfExtents: [(lensRadius * 2 + bridgeWidth) / 2 + 0.1, 0.025, lensRadius + 0.1],
            },
        ],
        build({ group }) {
            const frameMat = new THREE.MeshStandardMaterial({
                color: 0xc5a059,
                metalness: 0.9,
                roughness: 0.2,
                envMapIntensity: 1.2,
            });
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                metalness: 0.1,
                roughness: 0.05,
                transmission: 0.9,
                ior: 1.5,
                thickness: 0.02,
                transparent: true,
                envMapIntensity: 1.5,
            });

            const lensGeo = new THREE.CylinderGeometry(lensRadius, lensRadius, lensThick, 32);
            const frameGeo = new THREE.TorusGeometry(lensRadius + frameTube / 2, frameTube, 16, 32);

            const leftGroup = new THREE.Group();
            const leftLens = new THREE.Mesh(lensGeo, glassMat);
            leftLens.rotation.x = Math.PI / 2;
            leftGroup.add(leftLens);
            const leftFrame = new THREE.Mesh(frameGeo, frameMat);
            leftFrame.castShadow = true;
            leftFrame.receiveShadow = true;
            leftGroup.add(leftFrame);
            leftGroup.position.set(-lensRadius - bridgeWidth / 2, 0, 0);
            group.add(leftGroup);

            const rightGroup = new THREE.Group();
            const rightLens = new THREE.Mesh(lensGeo, glassMat);
            rightLens.rotation.x = Math.PI / 2;
            rightGroup.add(rightLens);
            const rightFrame = new THREE.Mesh(frameGeo, frameMat);
            rightFrame.castShadow = true;
            rightFrame.receiveShadow = true;
            rightGroup.add(rightFrame);
            rightGroup.position.set(lensRadius + bridgeWidth / 2, 0, 0);
            group.add(rightGroup);

            const bridgeCurve = new THREE.QuadraticBezierCurve3(
                new THREE.Vector3(-bridgeWidth / 2, 0, 0),
                new THREE.Vector3(0, 0.05, 0.05),
                new THREE.Vector3(bridgeWidth / 2, 0, 0)
            );
            const bridgeMesh = new THREE.Mesh(
                new THREE.TubeGeometry(bridgeCurve, 8, frameTube, 8, false),
                frameMat
            );
            bridgeMesh.castShadow = true;
            bridgeMesh.receiveShadow = true;
            group.add(bridgeMesh);

            const armCurveGeo = new THREE.CylinderGeometry(frameTube, frameTube, armLen, 8);
            const leftArm = new THREE.Mesh(armCurveGeo, frameMat);
            leftArm.rotation.x = Math.PI / 2;
            leftArm.rotation.z = Math.PI / 2 - 0.2;
            leftArm.position.set(-lensRadius * 1.5, 0, -armLen / 2 + 0.05);
            leftArm.castShadow = true;
            leftArm.receiveShadow = true;
            group.add(leftArm);

            const rightArm = new THREE.Mesh(armCurveGeo, frameMat);
            rightArm.rotation.x = Math.PI / 2;
            rightArm.rotation.z = -Math.PI / 2 + 0.2;
            rightArm.position.set(lensRadius * 1.5, -0.02, -armLen / 2 + 0.05);
            rightArm.castShadow = true;
            rightArm.receiveShadow = true;
            group.add(rightArm);

            const earpieceGeo = new THREE.TorusGeometry(0.05, frameTube, 8, 16, Math.PI);
            const leftEar = new THREE.Mesh(earpieceGeo, frameMat);
            leftEar.rotation.x = Math.PI / 2;
            leftEar.position.set(
                -lensRadius * 1.5 + (armLen / 2) * Math.cos(0.2),
                0,
                -armLen + 0.05
            );
            leftEar.castShadow = true;
            group.add(leftEar);

            const rightEar = new THREE.Mesh(earpieceGeo, frameMat);
            rightEar.rotation.x = Math.PI / 2;
            rightEar.rotation.y = Math.PI;
            rightEar.position.set(
                lensRadius * 1.5 - (armLen / 2) * Math.cos(0.2),
                -0.02,
                -armLen + 0.05
            );
            rightEar.castShadow = true;
            group.add(rightEar);

            group.rotation.x = -Math.PI / 2;
            group.rotation.order = 'YXZ';
        },
    });
}
