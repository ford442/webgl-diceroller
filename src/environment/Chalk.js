import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createChalk(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    return createProp(scene, physicsWorld, {
        name: 'Chalk',
        position,
        rotation: rotationY,
        build: ({ group, mesh }) => {
            // Chalk Material (white/dusty)
            const chalkMaterial = new THREE.MeshStandardMaterial({
                color: 0xeeeeee,
                roughness: 0.95,
                metalness: 0.0,
            });

            // Geometry: small cylinder
            const radius = 0.15;
            const height = 1.2;
            const chalkGeo = new THREE.CylinderGeometry(radius, radius, height, 12);
            // Rotate so it lays flat on the table
            chalkGeo.rotateZ(Math.PI / 2);

            const chalkMesh = mesh(chalkGeo, chalkMaterial);
            chalkMesh.position.y = radius; // Rest on the surface
            group.add(chalkMesh);
        },
        colliders: [
            {
                type: 'box',
                halfExtents: [0.6, 0.15, 0.15],
                offset: [0, 0.15, 0],
                materialTag: 0,
            },
        ],
    });
}
