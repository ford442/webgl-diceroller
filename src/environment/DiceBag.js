import * as THREE from 'three';
import { createProp, STATIC_MATERIAL } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createDiceBag(
    scene,
    physicsWorld,
    position = { x: -10, y: -1.95, z: 8 },
    rotationY = 0
) {
    const radius = 1.0;
    const bagFootY = -1.95;

    return createProp(scene, physicsWorld, {
        name: 'DiceBag',
        position: { x: position.x, y: bagFootY, z: position.z },
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [radius, radius * 0.8, radius],
                materialTag: STATIC_MATERIAL.LEATHER,
            },
        ],
        build({ group }) {
            const leatherBump = getWoodTextures().bump;
            leatherBump.repeat.set(2, 2);

            const leatherMaterial = new THREE.MeshStandardMaterial({
                color: 0x8b4513,
                roughness: 0.9,
                bumpMap: leatherBump,
                bumpScale: 0.05,
            });

            const stringMaterial = new THREE.MeshStandardMaterial({
                color: 0xd2b48c,
                roughness: 0.8,
            });

            const bodyGeo = new THREE.SphereGeometry(radius, 32, 16);
            bodyGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.8, 1));

            const bodyMesh = new THREE.Mesh(bodyGeo, leatherMaterial);
            bodyMesh.castShadow = true;
            bodyMesh.receiveShadow = true;
            bodyMesh.position.y = 0;
            group.add(bodyMesh);

            const neckGeo = new THREE.CylinderGeometry(0.7, 0.9, 0.5, 32, 1, true);
            const neckMesh = new THREE.Mesh(neckGeo, leatherMaterial);
            neckMesh.position.y = 0.7;
            neckMesh.castShadow = true;
            neckMesh.receiveShadow = true;
            group.add(neckMesh);

            const stringGeo = new THREE.TorusGeometry(0.7, 0.05, 16, 32);
            const stringMesh = new THREE.Mesh(stringGeo, stringMaterial);
            stringMesh.position.y = 0.7;
            stringMesh.rotation.x = Math.PI / 2;
            stringMesh.castShadow = true;
            stringMesh.receiveShadow = true;
            group.add(stringMesh);
        },
    });
}
