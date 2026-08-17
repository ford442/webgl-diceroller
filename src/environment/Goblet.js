import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createGoblet(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 12 },
    rotationY = 0
) {
    const scale = 0.6;
    const radius = 1.3 * scale;
    const height = 4.0 * scale;

    return createProp(scene, physicsWorld, {
        name: 'Goblet',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
                offset: { y: height / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const silverMat = materials.silver();

            const points = [];
            points.push(new THREE.Vector2(0, 0));
            points.push(new THREE.Vector2(0.8, 0.1));
            points.push(new THREE.Vector2(0.8, 0.2));
            points.push(new THREE.Vector2(0.2, 0.4));
            points.push(new THREE.Vector2(0.15, 0.8));
            points.push(new THREE.Vector2(0.2, 1.2));
            points.push(new THREE.Vector2(0.15, 1.6));
            points.push(new THREE.Vector2(0.8, 1.8));
            points.push(new THREE.Vector2(1.2, 2.4));
            points.push(new THREE.Vector2(1.3, 3.2));
            points.push(new THREE.Vector2(1.2, 3.8));
            points.push(new THREE.Vector2(1.25, 4.0));
            points.push(new THREE.Vector2(1.15, 4.0));
            points.push(new THREE.Vector2(1.1, 3.2));
            points.push(new THREE.Vector2(0.7, 2.2));
            points.push(new THREE.Vector2(0.0, 2.0));

            const latheGeo = new THREE.LatheGeometry(points, 32);
            const gobletMesh = mesh(latheGeo, silverMat);
            gobletMesh.scale.set(scale, scale, scale);
            group.add(gobletMesh);

            const ring = mesh(new THREE.TorusGeometry(0.2, 0.05, 16, 32), materials.gold(), {
                position: { y: 1.0 },
                rotation: { x: Math.PI / 2 },
            });
            ring.scale.set(scale, scale, scale);
            group.add(ring);
        },
    });
}
