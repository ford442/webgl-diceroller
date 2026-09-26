import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createTavernCoaster(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 5 },
    rotationY = 0
) {
    const radius = 0.8;
    const thickness = 0.1;

    const { diffuse, roughness, bump } = getWoodTextures();

    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 32);

    // Rotate texture for top/bottom mapping
    const woodMap = diffuse.clone();
    woodMap.rotation = Math.PI / 2;

    const material = new THREE.MeshStandardMaterial({
        map: woodMap,
        roughnessMap: roughness,
        bumpMap: bump,
        bumpScale: 0.02,
        color: 0x8b5a2b, // Slightly darkened wood
        roughness: 0.9,
    });

    return createProp(scene, physicsWorld, {
        name: 'TavernCoaster',
        position,
        rotation: rotationY,
        footOffsetY: thickness / 2,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: thickness / 2,
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            group.add(mesh(geometry, material));
        },
    });
}
