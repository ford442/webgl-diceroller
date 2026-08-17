import * as THREE from 'three';
import { createProp } from './propKit.js';
import { playPropImpact } from '../audio/DiceCollisionAudio.js';

export function createSkull(
    scene,
    physicsWorld,
    position = { x: -10, y: -2.4, z: -10 },
    rotationY = 0.3
) {
    const socketMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.9,
        metalness: 0.0,
    });

    const glowColor = 0xff0000;
    const eyeLightIntensity = 2.0;
    let isGlowing = false;
    let leftLight;
    let rightLight;

    const result = createProp(scene, physicsWorld, {
        name: 'SkullProp',
        position,
        rotation: rotationY,
        colliders: [{ type: 'box', halfExtents: [0.4, 0.45, 0.4] }],
        build({ group }) {
            const boneMat = new THREE.MeshStandardMaterial({
                color: 0xe3dac9,
                roughness: 0.7,
                metalness: 0.1,
            });

            const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), boneMat);
            cranium.scale.set(1.0, 1.2, 1.1);
            cranium.castShadow = true;
            cranium.receiveShadow = true;
            group.add(cranium);

            const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.4), boneMat);
            jaw.position.set(0, -0.35, 0.1);
            jaw.castShadow = true;
            jaw.receiveShadow = true;
            group.add(jaw);

            const socketGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16);
            const socketLeft = new THREE.Mesh(socketGeo, socketMat);
            socketLeft.rotation.x = Math.PI / 2;
            socketLeft.position.set(-0.12, -0.05, 0.32);
            group.add(socketLeft);

            const socketRight = new THREE.Mesh(socketGeo, socketMat);
            socketRight.rotation.x = Math.PI / 2;
            socketRight.position.set(0.12, -0.05, 0.32);
            group.add(socketRight);

            const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 3), socketMat);
            nose.rotation.x = -Math.PI / 2;
            nose.scale.z = 0.2;
            nose.position.set(0, -0.15, 0.35);
            group.add(nose);

            const toothGeo = new THREE.BoxGeometry(0.04, 0.06, 0.02);
            const startX = -(5 * 0.05) / 2;
            for (let i = 0; i < 6; i++) {
                const tooth = new THREE.Mesh(toothGeo, boneMat);
                tooth.position.set(startX + i * 0.05, -0.28, 0.34);
                group.add(tooth);
                const lowerTooth = new THREE.Mesh(toothGeo, boneMat);
                lowerTooth.position.set(startX + i * 0.05, -0.32, 0.34);
                group.add(lowerTooth);
            }

            leftLight = new THREE.PointLight(glowColor, 0, 2);
            leftLight.position.copy(socketLeft.position);
            leftLight.position.z += 0.05;
            group.add(leftLight);

            rightLight = new THREE.PointLight(glowColor, 0, 2);
            rightLight.position.copy(socketRight.position);
            rightLight.position.z += 0.05;
            group.add(rightLight);
        },
    });

    const toggleGlow = () => {
        const impactPos = new THREE.Vector3();
        result.group.getWorldPosition(impactPos);
        playPropImpact({
            surface: 'bone',
            volume: 0.5,
            position: { x: impactPos.x, y: impactPos.y, z: impactPos.z },
        });
        isGlowing = !isGlowing;
        const intensity = isGlowing ? eyeLightIntensity : 0;
        leftLight.intensity = intensity;
        rightLight.intensity = intensity;
        if (isGlowing) {
            socketMat.emissive.setHex(glowColor);
            socketMat.emissiveIntensity = 0.5;
        } else {
            socketMat.emissive.setHex(0x000000);
            socketMat.emissiveIntensity = 0;
        }
    };

    return { ...result, toggleGlow };
}
