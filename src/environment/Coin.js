import * as THREE from 'three';
import { getInstancedMetalMaterial } from '../core/MaterialPalette.js';
import { createProp, STATIC_MATERIAL } from './propKit.js';

export function createCoin(
    scene,
    physicsWorld,
    position = { x: 8, y: -2.75, z: -2 },
    rotationY = 0
) {
    const radius = 0.3;
    const height = 0.05;
    const numCoins = 12;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
    const instanceMaterial = getInstancedMetalMaterial();
    const goldColor = new THREE.Color(0xffd700);

    const colliders = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < numCoins; i++) {
        const offsetX = (Math.random() - 0.5) * 2.5;
        const offsetZ = (Math.random() - 0.5) * 2.5;
        const rotX = (Math.random() - 0.5) * 0.3;
        const rotY = rotationY + Math.random() * Math.PI * 2;
        const rotZ = (Math.random() - 0.5) * 0.3;

        colliders.push({
            type: 'cylinder',
            radius,
            halfHeight: height / 2,
            offset: { x: offsetX, y: height / 2, z: offsetZ },
            rotation: { x: rotX, y: rotY, z: rotZ },
            materialTag: STATIC_MATERIAL.METAL,
        });
    }

    return createProp(scene, physicsWorld, {
        name: 'Coin',
        position,
        rotation: rotationY,
        colliders,
        build({ group }) {
            const coins = new THREE.InstancedMesh(geometry, instanceMaterial, numCoins);
            coins.castShadow = true;
            coins.receiveShadow = true;
            coins.instanceMatrix.setUsage(THREE.StaticDrawUsage);

            for (let i = 0; i < numCoins; i++) {
                coins.setColorAt(i, goldColor);

                const offsetX = colliders[i].offset.x;
                const offsetZ = colliders[i].offset.z;
                const { x: rotX, y: rotY, z: rotZ } = colliders[i].rotation;

                dummy.position.set(offsetX, height / 2, offsetZ);
                dummy.rotation.set(rotX, rotY, rotZ);
                dummy.updateMatrix();
                coins.setMatrixAt(i, dummy.matrix);
            }

            coins.instanceMatrix.needsUpdate = true;
            if (coins.instanceColor) coins.instanceColor.needsUpdate = true;

            group.add(coins);
        },
    });
}
