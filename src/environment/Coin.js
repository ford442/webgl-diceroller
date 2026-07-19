import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { getInstancedMetalMaterial } from '../core/MaterialPalette.js';

export function createCoin(scene, physicsWorld, position = { x: 8, y: -2.75, z: -2 }, rotationY = 0) {
    const ammo = getAmmo();

    const coinGroup = new THREE.Group();
    coinGroup.name = 'Coin';

    const radius = 0.3;
    const height = 0.05;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);

    const numCoins = 12;
    const instanceMaterial = getInstancedMetalMaterial();
    const coins = new THREE.InstancedMesh(geometry, instanceMaterial, numCoins);
    coins.castShadow = true;
    coins.receiveShadow = true;
    coins.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const goldColor = new THREE.Color(0xffd700);

    const dummy = new THREE.Object3D();
    const pileCenter = new THREE.Vector3(position.x, position.y, position.z);

    if (ammo && physicsWorld) {
        const shape = new ammo.btCylinderShape(new ammo.btVector3(radius, height / 2, radius));
        coins.userData.physicsBodies = [];

        for (let i = 0; i < numCoins; i++) {
            coins.setColorAt(i, goldColor);

            const offsetX = (Math.random() - 0.5) * 2.5;
            const offsetZ = (Math.random() - 0.5) * 2.5;
            const posY = -2.75 + height / 2;

            dummy.position.set(pileCenter.x + offsetX, posY, pileCenter.z + offsetZ);
            dummy.rotation.set(
                (Math.random() - 0.5) * 0.3,
                rotationY + Math.random() * Math.PI * 2,
                (Math.random() - 0.5) * 0.3
            );
            dummy.updateMatrix();
            coins.setMatrixAt(i, dummy.matrix);
            coins.userData.physicsBodies.push(createStaticBody(physicsWorld, dummy, shape));
        }
    } else {
        for (let i = 0; i < numCoins; i++) {
            coins.setColorAt(i, goldColor);

            const offsetX = (Math.random() - 0.5) * 2.5;
            const offsetZ = (Math.random() - 0.5) * 2.5;
            const posY = -2.75 + height / 2;

            dummy.position.set(pileCenter.x + offsetX, posY, pileCenter.z + offsetZ);
            dummy.rotation.set(
                (Math.random() - 0.5) * 0.3,
                rotationY + Math.random() * Math.PI * 2,
                (Math.random() - 0.5) * 0.3
            );
            dummy.updateMatrix();
            coins.setMatrixAt(i, dummy.matrix);
        }
    }

    coins.instanceMatrix.needsUpdate = true;
    if (coins.instanceColor) coins.instanceColor.needsUpdate = true;

    coinGroup.add(coins);
    scene.add(coinGroup);

    return { group: coinGroup };
}
