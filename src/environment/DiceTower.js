import * as THREE from 'three';
import { createProp } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';
import {
    createDiceTowerColliders,
    createDiceTowerHopper,
    createDiceTowerParts,
} from './diceTowerLayout.js';

export function createDiceTower(
    scene,
    physicsWorld,
    position = { x: 12, y: -3.0, z: -8 },
    rotationY = -Math.PI / 6
) {
    // Geometry lives in diceTowerLayout.js so the headless drop-replay harness
    // can load the same chute this builds (see verify:tower-drop-replay).
    const hopper = createDiceTowerHopper();
    const colliders = createDiceTowerColliders();

    return createProp(scene, physicsWorld, {
        name: 'DiceTower',
        position,
        rotation: rotationY,
        hopper,
        colliders,
        build({ group }) {
            const {
                diffuse: woodDiffuse,
                bump: woodBump,
                roughness: woodRoughness,
            } = getWoodTextures();

            const woodMat = new THREE.MeshStandardMaterial({
                map: woodDiffuse,
                bumpMap: woodBump,
                bumpScale: 0.1,
                roughnessMap: woodRoughness,
                color: 0x8b5a2b,
                roughness: 0.8,
            });

            for (const [w, h, d, x, y, z, rotX] of createDiceTowerParts()) {
                const geo = new THREE.BoxGeometry(w, h, d);
                const mesh = new THREE.Mesh(geo, woodMat);
                mesh.position.set(x, y, z);
                mesh.rotation.set(rotX, 0, 0);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                group.add(mesh);
            }
        },
    });
}
