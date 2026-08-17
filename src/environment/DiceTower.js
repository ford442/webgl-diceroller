import * as THREE from 'three';
import { createProp } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createDiceTower(
    scene,
    physicsWorld,
    position = { x: 12, y: -3.0, z: -8 },
    rotationY = -Math.PI / 6
) {
    const width = 6;
    const depth = 6;
    const height = 15;
    const thickness = 0.5;
    const frontH = height / 3;
    const rampThick = 0.2;
    const rampW = width - thickness * 2 - 0.1;
    const rampLen = depth * 0.9;
    const trayDepth = 8;
    const trayHeight = 2;
    const trayZ = depth / 2 + trayDepth / 2 - thickness;

    return createProp(scene, physicsWorld, {
        name: 'DiceTower',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, height / 2, thickness / 2],
                offset: { y: height / 2, z: -depth / 2 + thickness / 2 },
            },
            {
                type: 'box',
                halfExtents: [thickness / 2, height / 2, depth / 2],
                offset: { x: -width / 2 + thickness / 2, y: height / 2 },
            },
            {
                type: 'box',
                halfExtents: [thickness / 2, height / 2, depth / 2],
                offset: { x: width / 2 - thickness / 2, y: height / 2 },
            },
            {
                type: 'box',
                halfExtents: [width / 2, frontH / 2, thickness / 2],
                offset: { y: height - frontH / 2, z: depth / 2 - thickness / 2 },
            },
            {
                type: 'box',
                halfExtents: [rampW / 2, rampThick / 2, rampLen / 2],
                offset: { y: 11, z: -0.5 },
                rotation: { x: 0.6 },
            },
            {
                type: 'box',
                halfExtents: [rampW / 2, rampThick / 2, rampLen / 2],
                offset: { y: 7, z: 0.5 },
                rotation: { x: -0.6 },
            },
            {
                type: 'box',
                halfExtents: [rampW / 2, rampThick / 2, (rampLen + 1) / 2],
                offset: { y: 3, z: -0.5 },
                rotation: { x: 0.6 },
            },
            {
                type: 'box',
                halfExtents: [width / 2, thickness / 2, trayDepth / 2],
                offset: { y: thickness / 2, z: trayZ },
            },
            {
                type: 'box',
                halfExtents: [thickness / 2, trayHeight / 2, trayDepth / 2],
                offset: { x: -width / 2 + thickness / 2, y: trayHeight / 2, z: trayZ },
            },
            {
                type: 'box',
                halfExtents: [thickness / 2, trayHeight / 2, trayDepth / 2],
                offset: { x: width / 2 - thickness / 2, y: trayHeight / 2, z: trayZ },
            },
            {
                type: 'box',
                halfExtents: [width / 2, trayHeight / 2, thickness / 2],
                offset: { y: trayHeight / 2, z: trayZ + trayDepth / 2 - thickness / 2 },
            },
        ],
        build({ group }) {
            const { diffuse: woodDiffuse, bump: woodBump, roughness: woodRoughness } =
                getWoodTextures();

            const woodMat = new THREE.MeshStandardMaterial({
                map: woodDiffuse,
                bumpMap: woodBump,
                bumpScale: 0.1,
                roughnessMap: woodRoughness,
                color: 0x8b5a2b,
                roughness: 0.8,
            });

            function addPart(w, h, d, x, y, z, rotX = 0, rotY = 0, rotZ = 0) {
                const geo = new THREE.BoxGeometry(w, h, d);
                const mesh = new THREE.Mesh(geo, woodMat);
                mesh.position.set(x, y, z);
                mesh.rotation.set(rotX, rotY, rotZ);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                group.add(mesh);
            }

            addPart(width, height, thickness, 0, height / 2, -depth / 2 + thickness / 2);
            addPart(thickness, height, depth, -width / 2 + thickness / 2, height / 2, 0);
            addPart(thickness, height, depth, width / 2 - thickness / 2, height / 2, 0);
            addPart(width, frontH, thickness, 0, height - frontH / 2, depth / 2 - thickness / 2);
            addPart(rampW, rampThick, rampLen, 0, 11, -0.5, 0.6, 0, 0);
            addPart(rampW, rampThick, rampLen, 0, 7, 0.5, -0.6, 0, 0);
            addPart(rampW, rampThick, rampLen + 1, 0, 3, -0.5, 0.6, 0, 0);
            addPart(width, thickness, trayDepth, 0, thickness / 2, trayZ);
            addPart(thickness, trayHeight, trayDepth, -width / 2 + thickness / 2, trayHeight / 2, trayZ);
            addPart(thickness, trayHeight, trayDepth, width / 2 - thickness / 2, trayHeight / 2, trayZ);
            addPart(
                width,
                trayHeight,
                thickness,
                0,
                trayHeight / 2,
                trayZ + trayDepth / 2 - thickness / 2
            );
        },
    });
}
