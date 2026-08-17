import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createPocketWatch(
    scene,
    physicsWorld,
    position = { x: 6, y: -2.65, z: 6 },
    rotationY = 0
) {
    const radius = 0.6;
    const thickness = 0.2;

    createProp(scene, physicsWorld, {
        name: 'PocketWatch',
        position,
        rotation: rotationY,
        footOffsetY: thickness / 2,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: thickness / 2,
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const goldMat = materials.gold();
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                metalness: 0,
                roughness: 0,
                transmission: 0.9,
                transparent: true,
                thickness: 0.1,
            });
            const faceTexture = generateWatchFaceTexture();
            const faceMat = new THREE.MeshStandardMaterial({
                map: faceTexture,
                roughness: 0.5,
                metalness: 0.1,
            });
            const handsMat = new THREE.MeshStandardMaterial({
                color: 0x111111,
                roughness: 0.8,
            });

            group.add(mesh(new THREE.CylinderGeometry(radius, radius, thickness, 32), goldMat));

            const faceRadius = radius - 0.05;
            group.add(
                mesh(new THREE.CircleGeometry(faceRadius, 32), faceMat, {
                    rotation: { x: -Math.PI / 2 },
                    position: { y: thickness / 2 + 0.001 },
                })
            );

            const hourHandGeo = new THREE.BoxGeometry(0.04, 0.01, 0.3);
            hourHandGeo.translate(0, 0, 0.1);
            const hourHand = mesh(hourHandGeo, handsMat, {
                position: { y: thickness / 2 + 0.02 },
                rotation: { y: -Math.PI / 3 },
            });
            group.add(hourHand);

            const minHandGeo = new THREE.BoxGeometry(0.03, 0.01, 0.45);
            minHandGeo.translate(0, 0, 0.15);
            group.add(
                mesh(minHandGeo, handsMat, {
                    position: { y: thickness / 2 + 0.03 },
                    rotation: { y: Math.PI / 3 },
                })
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), goldMat, {
                    position: { y: thickness / 2 + 0.04 },
                })
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(radius - 0.02, radius - 0.02, 0.05, 32),
                    glassMat,
                    { position: { y: thickness / 2 + 0.05 } }
                )
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16), goldMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { z: -radius - 0.05 },
                })
            );

            group.add(
                mesh(new THREE.TorusGeometry(0.15, 0.02, 8, 16), goldMat, {
                    position: { z: -radius - 0.2 },
                    rotation: { y: Math.PI / 2 },
                })
            );

            const lidPivot = new THREE.Group();
            lidPivot.position.set(0, thickness / 2, -radius);
            group.add(lidPivot);

            const lidMesh = mesh(new THREE.CylinderGeometry(radius, radius, 0.05, 32), goldMat, {
                position: { z: radius },
            });
            lidPivot.add(lidMesh);
            lidPivot.rotation.x = -Math.PI / 1.5;
        },
    });
}

function generateWatchFaceTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(256, 256, 250, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tickRadius = 200;

    for (let i = 1; i <= 12; i++) {
        const angle = ((i - 3) * (Math.PI * 2)) / 12;
        const x = 256 + Math.cos(angle) * tickRadius;
        const y = 256 + Math.sin(angle) * tickRadius;
        ctx.font = 'bold 40px serif';
        ctx.fillText(convertToRoman(i), x, y);
    }

    ctx.font = 'italic 30px serif';
    ctx.fillText('Chronos', 256, 350);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function convertToRoman(num) {
    const lookup = {
        M: 1000,
        CM: 900,
        D: 500,
        CD: 400,
        C: 100,
        XC: 90,
        L: 50,
        XL: 40,
        X: 10,
        IX: 9,
        V: 5,
        IV: 4,
        I: 1,
    };
    let roman = '';
    for (const i in lookup) {
        while (num >= lookup[i]) {
            roman += i;
            num -= lookup[i];
        }
    }
    return roman;
}
