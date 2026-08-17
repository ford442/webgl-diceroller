import * as THREE from 'three';
import { createProp } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

/**
 * Enhanced Chest with:
 * - Better PBR wood materials with normal/roughness maps
 * - Enhanced iron bands with proper metalness
 * - Subtle pulsing glow on the lock
 * - Detailed latch mechanism
 */
export function createChest(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    const width = 1.6;
    const depth = 1.0;
    const baseHeight = 0.8;
    const lidRadius = depth / 2;
    const totalHeight = baseHeight + lidRadius;

    let woodDiffuse;
    let woodBump;
    let woodRoughness;
    try {
        ({ diffuse: woodDiffuse, bump: woodBump, roughness: woodRoughness } = getWoodTextures());
    } catch (_e) {
        console.warn('Could not load wood textures, using procedural fallback');
    }

    const woodMat = new THREE.MeshStandardMaterial({
        map: woodDiffuse || generateWoodTexture(),
        bumpMap: woodBump,
        bumpScale: 0.08,
        roughnessMap: woodRoughness,
        color: 0x5c4033,
        roughness: 0.75,
        metalness: 0.05,
        envMapIntensity: 0.6,
    });

    const ironMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        metalness: 0.9,
        roughness: 0.55,
        envMapIntensity: 0.8,
    });

    const lockMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 1.0,
        roughness: 0.25,
        emissive: 0xffaa00,
        emissiveIntensity: 0.1,
        envMapIntensity: 1.2,
    });

    const haspMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        metalness: 0.85,
        roughness: 0.6,
        envMapIntensity: 0.7,
    });

    return createProp(scene, physicsWorld, {
        name: 'EnhancedChest',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, totalHeight / 2, depth / 2],
                offset: { y: totalHeight / 2 },
            },
        ],
        update(time) {
            const pulse = 0.1 + Math.sin(time * 1.5) * 0.05;
            lockMat.emissiveIntensity = pulse;
        },
        build({ group }) {
            const baseGeo = new THREE.BoxGeometry(width, baseHeight, depth);
            const baseMesh = new THREE.Mesh(baseGeo, woodMat);
            baseMesh.position.y = baseHeight / 2;
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            group.add(baseMesh);

            const lidGeo = new THREE.CylinderGeometry(
                lidRadius,
                lidRadius,
                width,
                24,
                1,
                false,
                0,
                Math.PI
            );
            const lidMesh = new THREE.Mesh(lidGeo, woodMat);
            lidMesh.rotation.z = -Math.PI / 2;
            lidMesh.rotation.x = -Math.PI / 2;
            lidMesh.position.y = baseHeight;
            lidMesh.castShadow = true;
            lidMesh.receiveShadow = true;
            group.add(lidMesh);

            const bandWidth = 0.18;
            const bandThickness = 0.06;
            const bandXOffsets = [-width / 3, width / 3];

            bandXOffsets.forEach((x) => {
                const bandBaseGeo = new THREE.BoxGeometry(bandWidth, baseHeight, depth + bandThickness);
                const bandBase = new THREE.Mesh(bandBaseGeo, ironMat);
                bandBase.position.set(x, baseHeight / 2, 0);
                bandBase.receiveShadow = true;
                bandBase.castShadow = true;
                group.add(bandBase);

                const bandLidGeo = new THREE.CylinderGeometry(
                    lidRadius + bandThickness / 2,
                    lidRadius + bandThickness / 2,
                    bandWidth,
                    24,
                    1,
                    false,
                    0,
                    Math.PI
                );
                const bandLid = new THREE.Mesh(bandLidGeo, ironMat);
                bandLid.rotation.z = -Math.PI / 2;
                bandLid.rotation.x = -Math.PI / 2;
                bandLid.position.set(x, baseHeight, 0);
                bandLid.castShadow = true;
                bandLid.receiveShadow = true;
                group.add(bandLid);

                for (let i = 0; i < 3; i++) {
                    const rivetGeo = new THREE.SphereGeometry(0.03, 8, 8);
                    const rivet = new THREE.Mesh(rivetGeo, ironMat);
                    rivet.position.set(
                        x,
                        baseHeight * (0.3 + i * 0.35),
                        depth / 2 + bandThickness / 2 + 0.02
                    );
                    group.add(rivet);
                }
            });

            const lockGroup = new THREE.Group();
            const lockGeo = new THREE.BoxGeometry(0.25, 0.3, 0.12);
            const lock = new THREE.Mesh(lockGeo, lockMat);
            lock.castShadow = true;
            lock.receiveShadow = true;
            lockGroup.add(lock);

            const keyholeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8);
            const keyholeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
            const keyhole = new THREE.Mesh(keyholeGeo, keyholeMat);
            keyhole.rotation.x = Math.PI / 2;
            keyhole.position.set(0, -0.05, 0.061);
            lockGroup.add(keyhole);

            const slitGeo = new THREE.BoxGeometry(0.02, 0.08, 0.02);
            const slit = new THREE.Mesh(slitGeo, keyholeMat);
            slit.position.set(0, -0.1, 0.061);
            lockGroup.add(slit);

            lockGroup.position.set(0, baseHeight - 0.22, depth / 2 + 0.04);
            group.add(lockGroup);

            const haspGroup = new THREE.Group();
            const haspPlateGeo = new THREE.BoxGeometry(0.18, 0.25, 0.05);
            const haspPlate = new THREE.Mesh(haspPlateGeo, haspMat);
            haspGroup.add(haspPlate);

            const haspLoopGeo = new THREE.TorusGeometry(0.08, 0.025, 8, 16, Math.PI);
            const haspLoop = new THREE.Mesh(haspLoopGeo, haspMat);
            haspLoop.position.set(0, -0.12, 0.08);
            haspGroup.add(haspLoop);

            haspGroup.position.set(0, baseHeight + 0.08, depth / 2 + 0.02);
            group.add(haspGroup);

            const cornerSize = 0.15;
            const cornerPositions = [
                { x: -width / 2 + 0.05, z: -depth / 2 + 0.05 },
                { x: width / 2 - 0.05, z: -depth / 2 + 0.05 },
                { x: -width / 2 + 0.05, z: depth / 2 - 0.05 },
                { x: width / 2 - 0.05, z: depth / 2 - 0.05 },
            ];

            cornerPositions.forEach((pos) => {
                const cornerGeo = new THREE.BoxGeometry(cornerSize, baseHeight * 0.8, cornerSize);
                const corner = new THREE.Mesh(cornerGeo, ironMat);
                corner.position.set(pos.x, baseHeight * 0.5, pos.z);
                corner.castShadow = true;
                group.add(corner);
            });
        },
    });
}

function generateWoodTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#5c4033';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#4a3328';
    ctx.lineWidth = 1;

    for (let i = 0; i < 30; i++) {
        ctx.beginPath();
        const x = Math.random() * 256;
        ctx.moveTo(x, 0);

        for (let y = 0; y < 256; y += 10) {
            const waveX = x + Math.sin(y * 0.02) * 5;
            ctx.lineTo(waveX, y);
        }

        ctx.globalAlpha = 0.3;
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}
