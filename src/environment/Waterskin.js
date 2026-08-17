import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createWaterskin(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 5 },
    rotation = Math.PI / 4
) {
    const result = createProp(scene, physicsWorld, {
        name: 'Waterskin',
        position,
        rotation,
        footOffsetY: 0.48,
        colliders: [{ type: 'box', halfExtents: [1.2, 0.48, 1.8] }],
        build({ group }) {
            const leatherMat = new THREE.MeshStandardMaterial({
                color: 0x5c3a21,
                roughness: 0.85,
                metalness: 0.0,
                bumpScale: 0.02,
            });

            const spoutMat = new THREE.MeshStandardMaterial({
                color: 0x8b5a2b,
                roughness: 0.9,
                metalness: 0.0,
            });

            const strapMat = new THREE.MeshStandardMaterial({
                color: 0x3d2314,
                roughness: 0.9,
                metalness: 0.0,
            });

            const bodyGeo = new THREE.SphereGeometry(1.2, 32, 16);
            const bodyMesh = new THREE.Mesh(bodyGeo, leatherMat);
            bodyMesh.scale.set(1, 0.4, 1.3);
            bodyMesh.castShadow = true;
            bodyMesh.receiveShadow = true;
            group.add(bodyMesh);

            const neckGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 16);
            const neckMesh = new THREE.Mesh(neckGeo, leatherMat);
            neckMesh.position.set(0, 0.1, 1.4);
            neckMesh.rotation.x = Math.PI / 2;
            neckMesh.castShadow = true;
            neckMesh.receiveShadow = true;
            group.add(neckMesh);

            const capGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 16);
            const capMesh = new THREE.Mesh(capGeo, spoutMat);
            capMesh.position.set(0, 0.1, 1.7);
            capMesh.rotation.x = Math.PI / 2;
            capMesh.castShadow = true;
            capMesh.receiveShadow = true;
            group.add(capMesh);

            const strapGeo = new THREE.TorusGeometry(0.25, 0.05, 8, 16);
            const strapMesh = new THREE.Mesh(strapGeo, strapMat);
            strapMesh.position.set(0, 0.1, 1.25);
            strapMesh.castShadow = true;
            strapMesh.receiveShadow = true;
            group.add(strapMesh);
        },
    });

    return {
        group: result.group,
        physicsBody: result.body ?? null,
    };
}
