import * as THREE from 'three';
import { createProp } from './propKit.js';
import { toCurrentTabletopY } from '../core/SceneMetrics.js';

export function createTarotDeck(
    scene,
    physicsWorld,
    position = { x: -6, y: -2.74, z: -3 },
    rotationY = Math.PI / 6
) {
    position = toCurrentTabletopY(position);

    const cardWidth = 1.4;
    const cardHeight = 2.4;
    const cardThickness = 0.01;
    const deckThickness = 0.5;

    return createProp(scene, physicsWorld, {
        name: 'TarotDeck',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [cardWidth / 2, deckThickness / 2, cardHeight / 2],
                offset: { y: deckThickness / 2 },
            },
            {
                type: 'box',
                halfExtents: [cardWidth / 2, cardThickness / 2, cardHeight / 2],
                offset: { x: 2.0, y: cardThickness / 2, z: 0.5 },
                rotation: { y: -Math.PI / 8 },
            },
            {
                type: 'box',
                halfExtents: [cardWidth / 2, cardThickness / 2, cardHeight / 2],
                offset: { x: 1.0, y: cardThickness / 2, z: -1.5 },
                rotation: { y: Math.PI / 12 },
            },
        ],
        build({ group }) {
            const backTexture = generateCardBackTexture();
            const faceTexture = generateTheFoolTexture();
            const edgeColor = 0xe0d6c8;

            const backMaterial = new THREE.MeshStandardMaterial({
                map: backTexture,
                roughness: 0.8,
                metalness: 0.1,
                color: 0xffffff,
            });

            const faceMaterial = new THREE.MeshStandardMaterial({
                map: faceTexture,
                roughness: 0.8,
                metalness: 0.1,
                color: 0xffffff,
            });

            const edgeMaterial = new THREE.MeshStandardMaterial({
                color: edgeColor,
                roughness: 0.9,
                metalness: 0.0,
            });

            const deckGeometry = new THREE.BoxGeometry(cardWidth, deckThickness, cardHeight);
            const deckMaterials = [
                edgeMaterial,
                edgeMaterial,
                backMaterial,
                edgeMaterial,
                edgeMaterial,
                edgeMaterial,
            ];

            const deckMesh = new THREE.Mesh(deckGeometry, deckMaterials);
            deckMesh.position.set(0, deckThickness / 2, 0);
            deckMesh.castShadow = true;
            deckMesh.receiveShadow = true;
            group.add(deckMesh);

            const cardGeometry = new THREE.BoxGeometry(cardWidth, cardThickness, cardHeight);

            const faceUpMaterials = [
                edgeMaterial,
                edgeMaterial,
                faceMaterial,
                backMaterial,
                edgeMaterial,
                edgeMaterial,
            ];

            const card1 = new THREE.Mesh(cardGeometry, faceUpMaterials);
            card1.position.set(2.0, cardThickness / 2, 0.5);
            card1.rotation.y = -Math.PI / 8;
            card1.castShadow = true;
            card1.receiveShadow = true;
            group.add(card1);

            const faceDownMaterials = [
                edgeMaterial,
                edgeMaterial,
                backMaterial,
                faceMaterial,
                edgeMaterial,
                edgeMaterial,
            ];

            const card2 = new THREE.Mesh(cardGeometry, faceDownMaterials);
            card2.position.set(1.0, cardThickness / 2, -1.5);
            card2.rotation.y = Math.PI / 12;
            card2.castShadow = true;
            card2.receiveShadow = true;
            group.add(card2);
        },
    });
}

function generateCardBackTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 8;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.strokeStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const angle = ((Math.PI * 2) / 8) * i;
        ctx.moveTo(cx + Math.cos(angle) * 40, cy + Math.sin(angle) * 40);
        ctx.lineTo(cx + Math.cos(angle) * 80, cy + Math.sin(angle) * 80);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy, 25, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#d4af37';
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 100; i++) {
        ctx.beginPath();
        ctx.arc(
            Math.random() * canvas.width,
            Math.random() * canvas.height,
            Math.random() * 3,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function generateTheFoolTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#e8dcc5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#222';
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

    ctx.fillStyle = '#222';
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.fillText('0', canvas.width / 2, 50);

    ctx.font = 'bold 28px serif';
    ctx.fillText('THE FOOL', canvas.width / 2, canvas.height - 30);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(cx + 60, cy - 100, 30, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.moveTo(16, cy + 120);
    ctx.lineTo(cx + 40, cy + 60);
    ctx.lineTo(cx + 40, canvas.height - 60);
    ctx.lineTo(16, canvas.height - 60);
    ctx.fill();

    ctx.fillStyle = '#c44';
    ctx.fillRect(cx - 30, cy - 60, 40, 80);

    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(cx - 10, cy - 80, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#222';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy + 20);
    ctx.lineTo(cx - 30, cy + 80);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy + 20);
    ctx.lineTo(cx + 30, cy + 60);
    ctx.stroke();

    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy + 20);
    ctx.lineTo(cx + 20, cy - 80);
    ctx.stroke();

    ctx.fillStyle = '#5a7850';
    ctx.beginPath();
    ctx.arc(cx + 20, cy - 80, 25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#aaa';
    ctx.fillRect(cx - 80, cy + 40, 40, 30);

    ctx.fillStyle = 'rgba(139, 69, 19, 0.1)';
    for (let i = 0; i < 50; i++) {
        ctx.beginPath();
        ctx.arc(
            Math.random() * canvas.width,
            Math.random() * canvas.height,
            Math.random() * 20 + 5,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.rotation = Math.PI / 2;
    texture.center.set(0.5, 0.5);
    return texture;
}
