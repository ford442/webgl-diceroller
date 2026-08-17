import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createLockpicks(
    scene,
    physicsWorld,
    position = { x: 4.5, y: -2.75, z: 0.5 },
    rotationY = Math.PI / 8
) {
    const pouchWidth = 1.2;
    const pouchLength = 2.0;
    const pouchThickness = 0.05;

    return createProp(scene, physicsWorld, {
        name: 'Lockpicks',
        position,
        rotation: rotationY,
        footOffsetY: pouchThickness / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [pouchWidth / 2, pouchThickness / 2, pouchLength / 2],
                materialTag: STATIC_MATERIAL.LEATHER,
            },
        ],
        build({ group }) {
            const {
                diffuseMap: leatherDiffuse,
                roughnessMap: leatherRoughness,
                bumpMap: leatherBump,
            } = generateLeatherTextures();

            const leatherMaterial = new THREE.MeshStandardMaterial({
                color: 0x4a2e15,
                map: leatherDiffuse,
                roughnessMap: leatherRoughness,
                bumpMap: leatherBump,
                bumpScale: 0.03,
                roughness: 0.8,
                metalness: 0.05,
            });

            const steelMaterial = materials.steel();
            const brassMaterial = materials.brass();

            const pouchMesh = mesh(
                new THREE.BoxGeometry(pouchWidth, pouchThickness, pouchLength),
                leatherMaterial
            );
            const topRoll = mesh(
                new THREE.CylinderGeometry(0.08, 0.08, pouchWidth, 16),
                leatherMaterial,
                { rotation: { z: Math.PI / 2 }, position: { y: 0.03, z: -pouchLength / 2 } }
            );
            pouchMesh.add(topRoll);
            group.add(pouchMesh);

            const pick1 = createHookPick(steelMaterial, brassMaterial);
            pick1.position.set(-0.2, pouchThickness, 0.2);
            pick1.rotation.y = Math.PI / 12;
            pick1.rotation.x = Math.PI / 2;
            group.add(pick1);

            const pick2 = createRakePick(steelMaterial, steelMaterial);
            pick2.position.set(0.1, pouchThickness, 0.1);
            pick2.rotation.y = -Math.PI / 8;
            pick2.rotation.x = Math.PI / 2;
            group.add(pick2);

            const wrench = createTensionWrench(steelMaterial);
            wrench.position.set(0.3, pouchThickness, -0.3);
            wrench.rotation.y = Math.PI / 6;
            wrench.rotation.x = Math.PI / 2;
            group.add(wrench);
        },
    });
}

function createHookPick(bladeMat, handleMat) {
    const pick = new THREE.Group();
    pick.add(
        mesh(new THREE.BoxGeometry(0.12, 0.8, 0.04), handleMat, { position: { y: -0.4 } })
    );
    pick.add(
        mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.6, 8), bladeMat, { position: { y: 0.3 } })
    );
    const hook = mesh(new THREE.TorusGeometry(0.04, 0.015, 8, 16, Math.PI), bladeMat, {
        position: { x: 0.04, y: 0.6 },
        rotation: { z: Math.PI / 2 },
    });
    pick.add(hook);
    return pick;
}

function createRakePick(bladeMat, handleMat) {
    const pick = new THREE.Group();
    pick.add(
        mesh(new THREE.BoxGeometry(0.12, 0.8, 0.04), handleMat, { position: { y: -0.4 } })
    );
    pick.add(
        mesh(new THREE.BoxGeometry(0.03, 0.6, 0.02), bladeMat, { position: { y: 0.3 } })
    );
    for (let i = 0; i < 3; i++) {
        pick.add(
            mesh(new THREE.ConeGeometry(0.02, 0.06, 8), bladeMat, {
                position: { x: 0.015, y: 0.5 + i * 0.05 },
                rotation: { z: -Math.PI / 2 },
            })
        );
    }
    return pick;
}

function createTensionWrench(mat) {
    const wrench = new THREE.Group();
    wrench.add(mesh(new THREE.BoxGeometry(0.06, 1.0, 0.02), mat, { position: { y: -0.1 } }));
    wrench.add(
        mesh(new THREE.BoxGeometry(0.2, 0.06, 0.02), mat, { position: { x: 0.07, y: 0.4 } })
    );
    return wrench;
}

function generateLeatherTextures() {
    const size = 512;

    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = size;
    diffCanvas.height = size;
    const diffCtx = diffCanvas.getContext('2d');
    diffCtx.fillStyle = '#4a2e15';
    diffCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        if (Math.random() > 0.5) {
            diffCtx.fillStyle = '#3a200a';
            diffCtx.globalAlpha = 0.1;
            diffCtx.beginPath();
            diffCtx.arc(x, y, Math.random() * 5 + 1, 0, Math.PI * 2);
            diffCtx.fill();
        } else {
            diffCtx.fillStyle = '#5c3a1b';
            diffCtx.globalAlpha = 0.05;
            diffCtx.fillRect(x, y, Math.random() * 20 + 2, 1);
        }
    }
    const diffuseMap = new THREE.CanvasTexture(diffCanvas);
    diffuseMap.colorSpace = THREE.SRGBColorSpace;
    diffuseMap.wrapS = THREE.RepeatWrapping;
    diffuseMap.wrapT = THREE.RepeatWrapping;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const roughCtx = roughCanvas.getContext('2d');
    roughCtx.globalAlpha = 1.0;
    roughCtx.fillStyle = '#cccccc';
    roughCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        roughCtx.fillStyle = Math.random() > 0.7 ? '#999999' : '#eeeeee';
        roughCtx.globalAlpha = 0.2;
        roughCtx.beginPath();
        roughCtx.arc(x, y, Math.random() * 10 + 2, 0, Math.PI * 2);
        roughCtx.fill();
    }
    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bumpCtx = bumpCanvas.getContext('2d');
    bumpCtx.globalAlpha = 1.0;
    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < 8000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        bumpCtx.fillStyle = Math.random() > 0.5 ? '#888888' : '#777777';
        bumpCtx.globalAlpha = 0.3;
        bumpCtx.fillRect(x, y, 2, 2);
    }
    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.colorSpace = THREE.NoColorSpace;
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;

    return { diffuseMap, roughnessMap, bumpMap };
}
