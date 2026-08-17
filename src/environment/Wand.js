import * as THREE from 'three';
import { createProp } from './propKit.js';
import { registerInteractiveObject } from '../interaction.js';

export function createWand(
    scene,
    physicsWorld,
    position = { x: 8, y: -2.7, z: 4 },
    rotationY = Math.PI / 4
) {
    const shaftLen = 1.0;
    const handleLen = 0.4;
    const totalLen = shaftLen + handleLen + 0.1;
    const yOffset = -0.35;

    let crystalMat;
    let glowLight;
    let isGlowing = true;

    const toggleGlow = () => {
        isGlowing = !isGlowing;
        crystalMat.emissiveIntensity = isGlowing ? 2.5 : 0.2;
        glowLight.intensity = isGlowing ? 2.0 : 0.0;
    };

    const result = createProp(scene, physicsWorld, {
        name: 'MagicWand',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: 0.05,
                halfHeight: totalLen / 2,
                rotation: { z: Math.PI / 2 },
            },
        ],
        build({ group }) {
            const woodMat = new THREE.MeshStandardMaterial({
                color: 0x2d1a11,
                roughness: 0.8,
                metalness: 0.1,
            });

            const goldMat = new THREE.MeshStandardMaterial({
                color: 0xd4af37,
                roughness: 0.3,
                metalness: 0.8,
                envMapIntensity: 1.0,
            });

            crystalMat = new THREE.MeshPhysicalMaterial({
                color: 0x00ffff,
                emissive: 0x0088ff,
                emissiveIntensity: 0.5,
                roughness: 0.1,
                transmission: 0.9,
                transparent: true,
            });

            const shaftGeo = new THREE.CylinderGeometry(0.02, 0.04, shaftLen, 16);
            const shaftMesh = new THREE.Mesh(shaftGeo, woodMat);
            shaftMesh.position.y = shaftLen / 2 + yOffset;
            shaftMesh.castShadow = true;
            shaftMesh.receiveShadow = true;
            group.add(shaftMesh);

            const handleGeo = new THREE.CylinderGeometry(0.05, 0.05, handleLen, 16);
            const handleMesh = new THREE.Mesh(handleGeo, woodMat);
            handleMesh.position.y = -handleLen / 2 + yOffset;
            handleMesh.castShadow = true;
            handleMesh.receiveShadow = true;
            group.add(handleMesh);

            const ringGeo = new THREE.TorusGeometry(0.055, 0.01, 8, 16);

            const ring1 = new THREE.Mesh(ringGeo, goldMat);
            ring1.rotation.x = Math.PI / 2;
            ring1.position.y = 0 + yOffset;
            group.add(ring1);

            const ring2 = new THREE.Mesh(ringGeo, goldMat);
            ring2.rotation.x = Math.PI / 2;
            ring2.position.y = -handleLen + yOffset;
            group.add(ring2);

            const crystalGeo = new THREE.OctahedronGeometry(0.06, 0);
            const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
            crystalMesh.position.y = shaftLen + 0.03 + yOffset;
            crystalMesh.scale.y = 2.0;
            group.add(crystalMesh);

            glowLight = new THREE.PointLight(0x00ffff, 0.5, 2.0);
            glowLight.position.y = shaftLen + 0.03 + yOffset;
            group.add(glowLight);

            group.rotation.set(0, rotationY, Math.PI / 2, 'YXZ');

            registerInteractiveObject(crystalMesh, toggleGlow);
        },
    });

    return { ...result, toggleGlow };
}
