import * as THREE from 'three';
import { createProp } from './propKit.js';

/**
 * Creates a detailed drinking tankard with pewter body, wooden handle,
 * and animated froth on top.
 */
export function createTankard(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 4 },
    rotation = 0
) {
    const bodyRadius = 0.55;
    const bodyHeight = 1.3;
    const baseRadius = 0.6;
    const wallThickness = 0.08;
    const aleLevel = bodyHeight * 0.85;
    const bubbles = [];

    return createProp(scene, physicsWorld, {
        name: 'Tankard',
        position,
        rotation,
        colliders: [
            {
                type: 'cylinder',
                radius: bodyRadius + 0.1,
                halfHeight: bodyHeight / 2,
                offset: { y: bodyHeight / 2 },
            },
        ],
        build({ group }) {
            const pewterMaterial = new THREE.MeshStandardMaterial({
                color: 0x8a8a8a,
                roughness: 0.35,
                metalness: 0.85,
                envMapIntensity: 1.0,
            });

            const innerPewterMaterial = new THREE.MeshStandardMaterial({
                color: 0x5a5a5a,
                roughness: 0.7,
                metalness: 0.6,
            });

            const woodMaterial = new THREE.MeshStandardMaterial({
                color: 0x5c3a21,
                roughness: 0.85,
                metalness: 0.0,
            });
            const woodGrainTexture = generateWoodGrainTexture();
            woodMaterial.bumpMap = woodGrainTexture;
            woodMaterial.bumpScale = 0.02;

            const aleMaterial = new THREE.MeshPhysicalMaterial({
                color: 0xc4741c,
                roughness: 0.1,
                metalness: 0.0,
                transmission: 0.4,
                thickness: 0.5,
                ior: 1.33,
            });

            const frothMaterial = new THREE.MeshStandardMaterial({
                color: 0xf5f0e1,
                roughness: 0.9,
                metalness: 0.0,
                emissive: 0x1a1510,
                emissiveIntensity: 0.1,
            });

            const bodyPoints = [];
            bodyPoints.push(new THREE.Vector2(0, 0));
            bodyPoints.push(new THREE.Vector2(baseRadius, 0));
            bodyPoints.push(new THREE.Vector2(bodyRadius, 0.2));
            bodyPoints.push(new THREE.Vector2(bodyRadius + 0.05, bodyHeight * 0.7));
            bodyPoints.push(new THREE.Vector2(bodyRadius + 0.12, bodyHeight));
            bodyPoints.push(new THREE.Vector2(bodyRadius + 0.08, bodyHeight + 0.05));
            bodyPoints.push(new THREE.Vector2(bodyRadius - wallThickness, bodyHeight));
            bodyPoints.push(new THREE.Vector2(bodyRadius - wallThickness - 0.02, 0.3));
            bodyPoints.push(new THREE.Vector2(0, 0.15));

            const bodyGeo = new THREE.LatheGeometry(bodyPoints, 32);
            const bodyMesh = new THREE.Mesh(bodyGeo, pewterMaterial);
            bodyMesh.castShadow = true;
            bodyMesh.receiveShadow = true;
            group.add(bodyMesh);

            const handleCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(bodyRadius - 0.05, bodyHeight * 0.75, 0),
                new THREE.Vector3(bodyRadius + 0.4, bodyHeight * 0.7, 0),
                new THREE.Vector3(bodyRadius + 0.5, bodyHeight * 0.4, 0),
                new THREE.Vector3(bodyRadius + 0.45, bodyHeight * 0.15, 0),
                new THREE.Vector3(bodyRadius - 0.05, bodyHeight * 0.2, 0),
            ]);

            const handleGeo = new THREE.TubeGeometry(handleCurve, 24, 0.1, 12, false);
            const handleMesh = new THREE.Mesh(handleGeo, woodMaterial);
            handleMesh.castShadow = true;
            handleMesh.receiveShadow = true;
            group.add(handleMesh);

            const connectorGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16);

            const topConnector = new THREE.Mesh(connectorGeo, pewterMaterial);
            topConnector.rotation.z = Math.PI / 2;
            topConnector.position.set(bodyRadius, bodyHeight * 0.75, 0);
            topConnector.castShadow = true;
            group.add(topConnector);

            const bottomConnector = new THREE.Mesh(connectorGeo, pewterMaterial);
            bottomConnector.rotation.z = Math.PI / 2;
            bottomConnector.position.set(bodyRadius - 0.02, bodyHeight * 0.2, 0);
            bottomConnector.castShadow = true;
            group.add(bottomConnector);

            const aleGeo = new THREE.CircleGeometry((bodyRadius - wallThickness - 0.02) * 0.95, 32);
            const aleMesh = new THREE.Mesh(aleGeo, aleMaterial);
            aleMesh.rotation.x = -Math.PI / 2;
            aleMesh.position.y = aleLevel;
            group.add(aleMesh);

            const frothGroup = new THREE.Group();
            frothGroup.position.y = aleLevel + 0.01;

            const bubbleCount = 15;
            for (let i = 0; i < bubbleCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * (bodyRadius - wallThickness - 0.1) * 0.8;
                const bubbleSize = 0.08 + Math.random() * 0.12;

                const bubbleGeo = new THREE.SphereGeometry(bubbleSize, 12, 10);
                bubbleGeo.scale(1, 0.4, 1);

                const bubble = new THREE.Mesh(bubbleGeo, frothMaterial);
                bubble.position.set(Math.cos(angle) * r, Math.random() * 0.05, Math.sin(angle) * r);
                bubble.userData.originalY = bubble.position.y;
                bubble.userData.phase = Math.random() * Math.PI * 2;
                bubble.userData.speed = 0.5 + Math.random() * 1.0;
                bubble.castShadow = true;
                frothGroup.add(bubble);
                bubbles.push(bubble);
            }

            const rimFrothGeo = new THREE.TorusGeometry(
                (bodyRadius - wallThickness) * 0.92,
                0.06,
                8,
                32
            );
            const rimFroth = new THREE.Mesh(rimFrothGeo, frothMaterial);
            rimFroth.rotation.x = Math.PI / 2;
            rimFroth.position.y = 0.02;
            rimFroth.scale.y = 0.5;
            frothGroup.add(rimFroth);

            group.add(frothGroup);

            const baseRingGeo = new THREE.TorusGeometry(baseRadius * 0.7, 0.03, 8, 32);
            const baseRing = new THREE.Mesh(baseRingGeo, innerPewterMaterial);
            baseRing.rotation.x = Math.PI / 2;
            baseRing.position.y = 0.02;
            group.add(baseRing);
        },
        update(time) {
            bubbles.forEach((bubble) => {
                const offset =
                    Math.sin(time * bubble.userData.speed + bubble.userData.phase) * 0.015;
                bubble.position.y = bubble.userData.originalY + offset;
                const scalePulse = 1 + Math.sin(time * 2 + bubble.userData.phase) * 0.05;
                bubble.scale.set(scalePulse, 0.4, scalePulse);
            });
        },
    });
}

function generateWoodGrainTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#3d2616';
    ctx.lineWidth = 2;

    for (let i = 0; i < 20; i++) {
        ctx.beginPath();
        const x = Math.random() * canvas.width;
        ctx.moveTo(x, 0);
        for (let y = 0; y < canvas.height; y += 20) {
            const waveX = x + Math.sin(y * 0.05) * 5 + (Math.random() - 0.5) * 3;
            ctx.lineTo(waveX, y);
        }
        ctx.globalAlpha = 0.3 + Math.random() * 0.3;
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}
