import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createSpyglass(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 7 },
    rotationY = Math.PI / 6
) {
    const radius = 0.31;
    const halfLength = 1.65;

    return createProp(scene, physicsWorld, {
        name: 'Spyglass',
        position,
        rotation: rotationY,
        footOffsetY: 0.3,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: halfLength,
                rotation: { z: Math.PI / 2 },
                offset: { z: 0.125 },
            },
        ],
        build({ group }) {
            const brassMaterial = new THREE.MeshStandardMaterial({
                color: 0xb5a642,
                metalness: 0.8,
                roughness: 0.3,
            });

            const leatherMaterial = new THREE.MeshStandardMaterial({
                color: 0x3d2314,
                roughness: 0.9,
                bumpScale: 0.05,
            });

            const glassMaterial = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                metalness: 0.1,
                roughness: 0.1,
                transmission: 0.9,
                thickness: 0.5,
                transparent: true,
                opacity: 0.8,
            });

            const segments = [
                { radius: 0.3, length: 1.5, z: 1.0, material: leatherMaterial },
                { radius: 0.25, length: 1.2, z: -0.1, material: brassMaterial },
                { radius: 0.2, length: 1.0, z: -1.0, material: brassMaterial },
            ];

            segments.forEach((seg) => {
                const geo = new THREE.CylinderGeometry(seg.radius, seg.radius, seg.length, 16);
                const mesh = new THREE.Mesh(geo, seg.material);
                mesh.rotation.x = Math.PI / 2;
                mesh.position.z = seg.z;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                group.add(mesh);
            });

            const ringGeo1 = new THREE.TorusGeometry(0.31, 0.03, 8, 24);
            const ring1 = new THREE.Mesh(ringGeo1, brassMaterial);
            ring1.position.z = 1.75;
            group.add(ring1);

            const ringGeo2 = new THREE.TorusGeometry(0.31, 0.03, 8, 24);
            const ring2 = new THREE.Mesh(ringGeo2, brassMaterial);
            ring2.position.z = 0.25;
            group.add(ring2);

            const ringGeo3 = new THREE.TorusGeometry(0.26, 0.02, 8, 24);
            const ring3 = new THREE.Mesh(ringGeo3, brassMaterial);
            ring3.position.z = -0.7;
            group.add(ring3);

            const ringGeo4 = new THREE.TorusGeometry(0.21, 0.02, 8, 24);
            const ring4 = new THREE.Mesh(ringGeo4, brassMaterial);
            ring4.position.z = -1.5;
            group.add(ring4);

            const lensGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.05, 16);
            const lens = new THREE.Mesh(lensGeo, glassMaterial);
            lens.rotation.x = Math.PI / 2;
            lens.position.z = 1.73;
            group.add(lens);
        },
    });
}
