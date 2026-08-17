import * as THREE from 'three';
import { createProp, STATIC_MATERIAL } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

/**
 * Creates a Wooden Dice Tray with a velvet interior and physics colliders
 * so dice can be rolled into it without escaping.
 */
export function createDiceTray(
    scene,
    physicsWorld,
    position = { x: -4, y: -2.75, z: -2 },
    rotationY = 0
) {
    const width = 8;
    const depth = 6;
    const height = 1.0;
    const thickness = 0.4;
    const floorThickness = 0.2;
    const physThick = thickness * 1.5;
    const physHeight = height * 1.5;
    const frontBackWidth = width - 2 * thickness;

    return createProp(scene, physicsWorld, {
        name: 'DiceTray',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, floorThickness / 2, depth / 2],
                offset: { y: floorThickness / 2 },
                materialTag: STATIC_MATERIAL.VELVET,
            },
            {
                type: 'box',
                halfExtents: [physThick / 2, physHeight / 2, depth / 2],
                offset: { x: -width / 2 + thickness / 2, y: height / 2 },
                materialTag: STATIC_MATERIAL.WOOD,
            },
            {
                type: 'box',
                halfExtents: [physThick / 2, physHeight / 2, depth / 2],
                offset: { x: width / 2 - thickness / 2, y: height / 2 },
                materialTag: STATIC_MATERIAL.WOOD,
            },
            {
                type: 'box',
                halfExtents: [frontBackWidth / 2, physHeight / 2, physThick / 2],
                offset: { y: height / 2, z: -depth / 2 + thickness / 2 },
                materialTag: STATIC_MATERIAL.WOOD,
            },
            {
                type: 'box',
                halfExtents: [frontBackWidth / 2, physHeight / 2, physThick / 2],
                offset: { y: height / 2, z: depth / 2 - thickness / 2 },
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const { diffuse: woodDiffuse, roughness: woodRoughness, bump: woodBump } =
                getWoodTextures();

            const woodMaterial = new THREE.MeshStandardMaterial({
                map: woodDiffuse,
                roughnessMap: woodRoughness,
                bumpMap: woodBump,
                bumpScale: 0.05,
                color: 0x8b5a2b,
                roughness: 0.8,
            });

            const velvetTexture = generateVelvetTexture();
            const velvetMaterial = new THREE.MeshStandardMaterial({
                map: velvetTexture,
                color: 0x8b0000,
                roughness: 0.9,
                metalness: 0.1,
            });

            const floorGeo = new THREE.BoxGeometry(width, floorThickness, depth);
            const floorMaterials = [
                woodMaterial,
                woodMaterial,
                velvetMaterial,
                woodMaterial,
                woodMaterial,
                woodMaterial,
            ];

            const floorMesh = new THREE.Mesh(floorGeo, floorMaterials);
            floorMesh.position.set(0, floorThickness / 2, 0);
            floorMesh.castShadow = true;
            floorMesh.receiveShadow = true;
            group.add(floorMesh);

            const wallHeight = height;
            const sideGeo = new THREE.BoxGeometry(thickness, wallHeight, depth);

            const leftWall = new THREE.Mesh(sideGeo, woodMaterial);
            leftWall.position.set(-width / 2 + thickness / 2, wallHeight / 2, 0);
            leftWall.castShadow = true;
            leftWall.receiveShadow = true;
            group.add(leftWall);

            const rightWall = new THREE.Mesh(sideGeo, woodMaterial);
            rightWall.position.set(width / 2 - thickness / 2, wallHeight / 2, 0);
            rightWall.castShadow = true;
            rightWall.receiveShadow = true;
            group.add(rightWall);

            const frontBackGeo = new THREE.BoxGeometry(frontBackWidth, wallHeight, thickness);

            const backWall = new THREE.Mesh(frontBackGeo, woodMaterial);
            backWall.position.set(0, wallHeight / 2, -depth / 2 + thickness / 2);
            backWall.castShadow = true;
            backWall.receiveShadow = true;
            group.add(backWall);

            const frontWall = new THREE.Mesh(frontBackGeo, woodMaterial);
            frontWall.position.set(0, wallHeight / 2, depth / 2 - thickness / 2);
            frontWall.castShadow = true;
            frontWall.receiveShadow = true;
            group.add(frontWall);
        },
    });
}

function generateVelvetTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#8B0000';
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 8000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 2 + 1;

        ctx.fillStyle = Math.random() > 0.5 ? '#A52A2A' : '#600000';
        ctx.globalAlpha = Math.random() * 0.3 + 0.1;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.globalAlpha = 0.05;
    ctx.lineWidth = 4;
    for (let i = 0; i < 50; i++) {
        const y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.quadraticCurveTo(
            size / 2,
            y + (Math.random() - 0.5) * 50,
            size,
            y + (Math.random() - 0.5) * 20
        );
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
