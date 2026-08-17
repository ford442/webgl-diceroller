import * as THREE from 'three';
import { createProp } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createDiceJail(
    scene,
    physicsWorld,
    position = { x: -12, y: -2.75, z: 5 },
    rotationY = Math.PI / 4
) {
    const size = 2.0;
    const height = 2.0;
    const thickness = 0.2;
    const barRadius = 0.05;
    const wallThick = 0.1;
    const wallH = height - 2 * thickness;
    const halfSize = size / 2;

    return createProp(scene, physicsWorld, {
        name: 'DiceJail',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [size / 2, thickness / 2, size / 2],
                offset: { y: thickness / 2 },
            },
            {
                type: 'box',
                halfExtents: [size / 2, thickness / 2, size / 2],
                offset: { y: height - thickness / 2 },
            },
            {
                type: 'box',
                halfExtents: [size / 2, wallH / 2, wallThick / 2],
                offset: { y: height / 2, z: halfSize - wallThick / 2 },
            },
            {
                type: 'box',
                halfExtents: [size / 2, wallH / 2, wallThick / 2],
                offset: { y: height / 2, z: -halfSize + wallThick / 2 },
            },
            {
                type: 'box',
                halfExtents: [wallThick / 2, wallH / 2, size / 2],
                offset: { y: height / 2, x: -halfSize + wallThick / 2 },
            },
            {
                type: 'box',
                halfExtents: [wallThick / 2, wallH / 2, size / 2],
                offset: { y: height / 2, x: halfSize - wallThick / 2 },
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
                color: 0x5c4033,
                roughness: 0.8,
            });

            const metalMat = new THREE.MeshStandardMaterial({
                color: 0x444444,
                metalness: 0.8,
                roughness: 0.4,
            });

            const signMat = createSignMaterial();

            const baseGeo = new THREE.BoxGeometry(size, thickness, size);
            const baseMesh = new THREE.Mesh(baseGeo, woodMat);
            baseMesh.position.y = thickness / 2;
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            group.add(baseMesh);

            const topMesh = new THREE.Mesh(baseGeo, woodMat);
            topMesh.position.y = height - thickness / 2;
            topMesh.castShadow = true;
            topMesh.receiveShadow = true;
            group.add(topMesh);

            const postRadius = 0.1;
            const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, height - 2 * thickness, 8);
            const barGeo = new THREE.CylinderGeometry(barRadius, barRadius, height - 2 * thickness, 8);

            const barY = height / 2;

            const corners = [
                { x: -halfSize + postRadius, z: -halfSize + postRadius },
                { x: halfSize - postRadius, z: -halfSize + postRadius },
                { x: -halfSize + postRadius, z: halfSize - postRadius },
                { x: halfSize - postRadius, z: halfSize - postRadius },
            ];

            corners.forEach((pos) => {
                const post = new THREE.Mesh(postGeo, woodMat);
                post.position.set(pos.x, barY, pos.z);
                post.castShadow = true;
                post.receiveShadow = true;
                group.add(post);
            });

            const innerSpace = size - 2 * postRadius;
            const step = innerSpace / 3;

            [-1, 1].forEach((side) => {
                const z = side * (halfSize - postRadius);
                for (let i = 1; i <= 2; i++) {
                    const x = -halfSize + postRadius + i * step;
                    const bar = new THREE.Mesh(barGeo, metalMat);
                    bar.position.set(x, barY, z);
                    bar.castShadow = true;
                    bar.receiveShadow = true;
                    group.add(bar);
                }
            });

            [-1, 1].forEach((side) => {
                const x = side * (halfSize - postRadius);
                for (let i = 1; i <= 2; i++) {
                    const z = -halfSize + postRadius + i * step;
                    const bar = new THREE.Mesh(barGeo, metalMat);
                    bar.position.set(x, barY, z);
                    bar.castShadow = true;
                    bar.receiveShadow = true;
                    group.add(bar);
                }
            });

            const signGeo = new THREE.BoxGeometry(0.8, 0.4, 0.05);
            const signMesh = new THREE.Mesh(signGeo, signMat);
            signMesh.position.set(0, height - thickness / 2, halfSize + 0.03);
            signMesh.rotation.x = -0.1;
            group.add(signMesh);
        },
    });
}

function createSignMaterial() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = '#5c4033';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 118);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 60px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JAIL', 128, 64);

    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 128;
        const r = Math.random() * 10;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    return new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        color: 0xffffff,
    });
}
