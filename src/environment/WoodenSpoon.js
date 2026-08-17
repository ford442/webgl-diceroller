import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createWoodenSpoon(
    scene,
    physicsWorld,
    position = { x: -6, y: -2.75, z: 6 },
    rotationY = Math.PI / 4
) {
    const handleLen = 1.2;
    const bowlRadius = 0.2;
    const totalLen = handleLen + bowlRadius * 2.4;

    return createProp(scene, physicsWorld, {
        name: 'WoodenSpoon',
        position,
        rotation: rotationY,
        footOffsetY: 0.06,
        colliders: [
            {
                type: 'box',
                halfExtents: [bowlRadius, 0.1, totalLen / 2],
                offset: { z: 0.45 },
            },
        ],
        build({ group }) {
            const woodMat = new THREE.MeshStandardMaterial({
                color: 0x8b5a2b,
                roughness: 0.8,
                metalness: 0.0,
            });

            const handleRadius = 0.05;
            const handleGeo = new THREE.CylinderGeometry(handleRadius, handleRadius, handleLen, 16);
            const handleMesh = new THREE.Mesh(handleGeo, woodMat);
            handleMesh.rotation.x = Math.PI / 2;
            handleMesh.position.z = handleLen / 2;
            handleMesh.castShadow = true;
            handleMesh.receiveShadow = true;
            group.add(handleMesh);

            const bowlGeo = new THREE.SphereGeometry(bowlRadius, 16, 16);
            bowlGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.3, 1.2));
            const bowlMesh = new THREE.Mesh(bowlGeo, woodMat);
            bowlMesh.position.z = -0.1;
            bowlMesh.castShadow = true;
            bowlMesh.receiveShadow = true;
            group.add(bowlMesh);
        },
    });
}
