import * as THREE from 'three';
import { createProp } from './propKit.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createDMScreen(
    scene,
    physicsWorld,
    position = { x: 0, y: -2.75, z: -7 },
    rotationY = 0,
    { scale = 1 } = {}
) {
    const panelThickness = 0.2;
    const panelHeight = 4.0;
    const centerPanelWidth = 8.0;
    const sidePanelWidth = 4.0;
    const sidePanelAngle = Math.PI / 4;
    const leftPivotX = -centerPanelWidth / 2;
    const leftPivotZ = -panelThickness / 2;
    const rightPivotX = centerPanelWidth / 2;
    const rightPivotZ = -panelThickness / 2;

    const leftCenter = new THREE.Vector3(-sidePanelWidth / 2, 0, 0);
    leftCenter.applyAxisAngle(new THREE.Vector3(0, 1, 0), sidePanelAngle);

    const rightCenter = new THREE.Vector3(sidePanelWidth / 2, 0, 0);
    rightCenter.applyAxisAngle(new THREE.Vector3(0, 1, 0), -sidePanelAngle);

    return createProp(scene, physicsWorld, {
        name: 'DMScreen',
        position,
        rotation: rotationY,
        scale,
        colliders: [
            {
                type: 'box',
                halfExtents: [centerPanelWidth / 2, panelHeight / 2, panelThickness / 2],
                offset: { y: panelHeight / 2 },
            },
            {
                type: 'box',
                halfExtents: [sidePanelWidth / 2, panelHeight / 2, panelThickness / 2],
                offset: {
                    x: leftPivotX + leftCenter.x,
                    y: panelHeight / 2,
                    z: leftPivotZ + leftCenter.z,
                },
                rotation: { y: sidePanelAngle },
            },
            {
                type: 'box',
                halfExtents: [sidePanelWidth / 2, panelHeight / 2, panelThickness / 2],
                offset: {
                    x: rightPivotX + rightCenter.x,
                    y: panelHeight / 2,
                    z: rightPivotZ + rightCenter.z,
                },
                rotation: { y: -sidePanelAngle },
            },
        ],
        build({ group }) {
            const {
                diffuse: woodDiffuse,
                bump: woodBump,
                roughness: woodRoughness,
            } = getWoodTextures();
            woodDiffuse.repeat.set(1, 1);
            woodBump.repeat.set(1, 1);
            woodRoughness.repeat.set(1, 1);
            woodBump.colorSpace = THREE.NoColorSpace;
            woodRoughness.colorSpace = THREE.NoColorSpace;

            const woodMaterial = new THREE.MeshStandardMaterial({
                map: woodDiffuse,
                bumpMap: woodBump,
                bumpScale: 0.05,
                roughnessMap: woodRoughness,
                roughness: 0.8,
                color: 0x8b5a2b,
            });

            // BoxGeometry material slots: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z.
            // Only the DM-facing (+z) side of the center panel carries the charts.
            const chartsMaterial = new THREE.MeshStandardMaterial({
                map: generateDMChartsTexture(),
                roughness: 0.7,
                metalness: 0.05,
            });
            const centerMaterials = [
                woodMaterial,
                woodMaterial,
                woodMaterial,
                woodMaterial,
                chartsMaterial,
                woodMaterial,
            ];

            const centerGeom = new THREE.BoxGeometry(centerPanelWidth, panelHeight, panelThickness);
            const centerMesh = new THREE.Mesh(centerGeom, centerMaterials);
            centerMesh.position.set(0, panelHeight / 2, 0);
            centerMesh.castShadow = true;
            centerMesh.receiveShadow = true;
            group.add(centerMesh);

            const sideGeom = new THREE.BoxGeometry(sidePanelWidth, panelHeight, panelThickness);

            const leftMesh = new THREE.Mesh(sideGeom, woodMaterial);
            leftMesh.position.set(-sidePanelWidth / 2, 0, 0);

            const leftPivot = new THREE.Group();
            leftPivot.position.set(leftPivotX, panelHeight / 2, leftPivotZ);
            leftPivot.rotation.y = sidePanelAngle;
            leftPivot.add(leftMesh);
            group.add(leftPivot);

            const rightMesh = new THREE.Mesh(sideGeom, woodMaterial);
            rightMesh.position.set(sidePanelWidth / 2, 0, 0);

            const rightPivot = new THREE.Group();
            rightPivot.position.set(rightPivotX, panelHeight / 2, rightPivotZ);
            rightPivot.rotation.y = -sidePanelAngle;
            rightPivot.add(rightMesh);
            group.add(rightPivot);
        },
    });
}

function generateDMChartsTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fdf5e6';
    ctx.fillRect(0, 0, 1024, 512);

    ctx.fillStyle = '#000';
    ctx.font = 'bold 30px serif';
    ctx.fillText('RANDOM ENCOUNTERS', 50, 50);

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.moveTo(50, 60);
    ctx.lineTo(400, 60);
    ctx.stroke();

    ctx.font = '24px monospace';
    for (let i = 0; i < 10; i++) {
        ctx.fillText(`1d20 + ${i}: Goblin Skirmisher`, 50, 90 + i * 30);
    }

    ctx.font = 'bold 30px serif';
    ctx.fillText('WEAPON STATS', 500, 50);
    ctx.beginPath();
    ctx.moveTo(500, 60);
    ctx.lineTo(900, 60);
    ctx.stroke();

    ctx.font = '24px monospace';
    const weapons = ['Dagger      1d4', 'Shortsword  1d6', 'Longsword   1d8', 'Greataxe    1d12'];
    weapons.forEach((w, i) => {
        ctx.fillText(w, 500, 90 + i * 30);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
