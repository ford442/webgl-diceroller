import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createCoin(scene, physicsWorld) {
    const ammo = getAmmo();

    // Group to hold all coins
    const coinGroup = new THREE.Group();
    coinGroup.name = 'Coin';

    // Gold Material
    const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xffd700, // Gold color
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.0
    });

    // Coin Geometry
    const radius = 0.3;
    const height = 0.05;
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
    // Cylinder geometry is aligned along Y axis by default, which is perfect for coins lying flat.

    // Create a scattered pile of coins
    const numCoins = 12;
    // Central position for the pile
    const pileCenter = new THREE.Vector3(5, -2.75, -2);

    for (let i = 0; i < numCoins; i++) {
        const coinMesh = new THREE.Mesh(geometry, goldMaterial);

        // Randomize position slightly around the center
        const offsetX = (Math.random() - 0.5) * 2.5;
        const offsetZ = (Math.random() - 0.5) * 2.5;

        // We want the coins to rest on the table.
        // If table surface is -2.75, the center of the cylinder should be -2.75 + height/2.
        const posY = -2.75 + height / 2;

        coinMesh.position.set(pileCenter.x + offsetX, posY, pileCenter.z + offsetZ);

        // Random rotation around Y axis
        coinMesh.rotation.y = Math.random() * Math.PI;

        // Slightly random rotation around X and Z if they are overlapping,
        // but for static bodies it's safer to keep them flat to prevent dice catching under them.
        coinMesh.castShadow = true;
        coinMesh.receiveShadow = true;

        coinGroup.add(coinMesh);

        // Physics
        if (ammo) {
            // Note: btCylinderShape expects a vector with half extents.
            // By default Three.js cylinder is along Y. ammo.btCylinderShape assumes Y as well.
            const halfExtents = new ammo.btVector3(radius, height / 2, radius);
            const shape = new ammo.btCylinderShape(halfExtents);
            createStaticBody(physicsWorld, coinMesh, shape);
        }
    }

    scene.add(coinGroup);

    return {
        group: coinGroup
    };
}
