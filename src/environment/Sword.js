import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createSword(
    scene,
    physicsWorld,
    position = { x: -8, y: -2.45, z: 8 },
    rotationY = -Math.PI / 4
) {
    const centerOffsetZ = -4.0;

    const result = createProp(scene, physicsWorld, {
        name: 'Sword',
        position,
        rotation: rotationY,
        colliders: [{ type: 'box', halfExtents: [2.0, 0.3, 8.0] }],
        build({ group }) {
            const steelMaterial = new THREE.MeshStandardMaterial({
                color: 0xaaaaaa,
                metalness: 0.9,
                roughness: 0.2,
            });

            const goldMaterial = new THREE.MeshStandardMaterial({
                color: 0xffd700,
                metalness: 0.8,
                roughness: 0.3,
            });

            const leatherMaterial = new THREE.MeshStandardMaterial({
                color: 0x3a2c21,
                roughness: 0.95,
            });

            const bladeGeo = new THREE.BoxGeometry(1.2, 0.15, 12.0);
            const blade = new THREE.Mesh(bladeGeo, steelMaterial);
            blade.position.z = 6.0 + centerOffsetZ;
            blade.castShadow = true;
            blade.receiveShadow = true;
            group.add(blade);

            const guardGeo = new THREE.BoxGeometry(4.0, 0.3, 0.6);
            const guard = new THREE.Mesh(guardGeo, goldMaterial);
            guard.position.z = 0 + centerOffsetZ;
            guard.castShadow = true;
            guard.receiveShadow = true;
            group.add(guard);

            const handleGeo = new THREE.CylinderGeometry(0.35, 0.4, 3.0, 12);
            const handle = new THREE.Mesh(handleGeo, leatherMaterial);
            handle.rotation.x = Math.PI / 2;
            handle.position.z = -1.8 + centerOffsetZ;
            handle.castShadow = true;
            handle.receiveShadow = true;
            group.add(handle);

            const pommelGeo = new THREE.SphereGeometry(0.6, 16, 16);
            const pommel = new THREE.Mesh(pommelGeo, goldMaterial);
            pommel.position.z = -3.6 + centerOffsetZ;
            pommel.scale.set(1.0, 0.8, 1.2);
            pommel.castShadow = true;
            pommel.receiveShadow = true;
            group.add(pommel);
        },
    });

    return result.group;
}
