import * as THREE from 'three';
import { createProp, materials, mesh } from './propKit.js';

export function createQuill(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotation = 0
) {
    return createProp(scene, physicsWorld, {
        name: 'Quill',
        position,
        rotation,
        colliders: [{ type: 'box', halfExtents: [0.6, 0.05, 0.15] }],
        build({ group }) {
            // Feather part (Cylinder, flattened, with a white/grey material)
            const featherMat = new THREE.MeshStandardMaterial({
                color: 0xeeeeee,
                roughness: 0.9,
                metalness: 0.1,
            });
            const featherGeo = new THREE.CylinderGeometry(0.05, 0.15, 1.0, 8);

            const feather = mesh(featherGeo, featherMat, {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: Math.PI / 2 },
            });
            feather.scale.set(1, 1, 0.1); // Flatten it

            // Nib part (Cone, metallic)
            const nibGeo = new THREE.ConeGeometry(0.05, 0.2, 8);
            const nib = mesh(nibGeo, materials.steel(), {
                position: { x: -0.6, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: Math.PI / 2 },
            });

            group.add(feather);
            group.add(nib);
        },
    });
}
