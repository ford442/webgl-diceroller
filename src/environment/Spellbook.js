import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createSpellbook(
    scene,
    physicsWorld,
    position = { x: -10, y: -2.35, z: 8 },
    rotationY = Math.PI / 4
) {
    const width = 3.5;
    const height = 0.8;
    const depth = 4.5;

    return createProp(scene, physicsWorld, {
        name: 'Spellbook',
        position,
        rotation: rotationY,
        colliders: [{ type: 'box', halfExtents: [width / 2, height / 2, depth / 2] }],
        build({ group }) {
            const coverMat = new THREE.MeshStandardMaterial({
                color: 0x2b1b54,
                roughness: 0.7,
                metalness: 0.1,
            });
            const goldMat = new THREE.MeshStandardMaterial({
                color: 0xffd700,
                roughness: 0.3,
                metalness: 0.8,
            });
            const pagesMat = new THREE.MeshStandardMaterial({
                color: 0xf5deb3,
                roughness: 0.9,
                metalness: 0.0,
            });

            const coverMesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), coverMat);
            coverMesh.castShadow = true;
            coverMesh.receiveShadow = true;
            group.add(coverMesh);

            const pagesMesh = new THREE.Mesh(
                new THREE.BoxGeometry(width - 0.2, height - 0.1, depth - 0.1),
                pagesMat
            );
            pagesMesh.position.set(0.1, 0, 0);
            pagesMesh.castShadow = true;
            pagesMesh.receiveShadow = true;
            group.add(pagesMesh);

            const claspMesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, height + 0.02, 1.0),
                goldMat
            );
            claspMesh.position.set(width / 2 - 0.25, 0, 0);
            claspMesh.castShadow = true;
            claspMesh.receiveShadow = true;
            group.add(claspMesh);

            const glowMat = new THREE.MeshStandardMaterial({
                color: 0x00ffff,
                emissive: 0x0088ff,
                emissiveIntensity: 0.8,
                roughness: 0.2,
            });
            const symbolGroup = new THREE.Group();
            const circleMesh = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 8, 32), glowMat);
            circleMesh.rotation.x = -Math.PI / 2;
            symbolGroup.add(circleMesh);
            const triMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 3), glowMat);
            triMesh.rotation.set(0, Math.PI / 2, 0);
            symbolGroup.add(triMesh);
            symbolGroup.position.set(0, height / 2 + 0.01, 0);
            group.add(symbolGroup);

            const bookLight = new THREE.PointLight(0x0088ff, 0.5, 3);
            bookLight.position.set(0, height / 2 + 0.2, 0);
            group.add(bookLight);
        },
    });
}
