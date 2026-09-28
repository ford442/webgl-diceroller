import * as THREE from 'three';
import { createProp } from './propKit.js';

function generateTarotTexture(name, number, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 426;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f0e6d2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

    ctx.fillStyle = color;
    ctx.fillRect(20, 50, canvas.width - 40, canvas.height - 100);

    ctx.fillStyle = '#000';
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, canvas.width / 2, 40);
    ctx.fillText(number, canvas.width / 2, canvas.height - 15);

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 60, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 60);
    ctx.lineTo(canvas.width / 2, canvas.height - 60);
    ctx.moveTo(30, canvas.height / 2);
    ctx.lineTo(canvas.width - 30, canvas.height / 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

const CARDS = [
    { name: 'THE FOOL', number: '0', color: '#ffcc00' },
    { name: 'DEATH', number: 'XIII', color: '#333333' },
    { name: 'THE TOWER', number: 'XVI', color: '#8b0000' },
];

export function createTarotCards(
    scene,
    physicsWorld,
    position = { x: -7, y: -2.745, z: 6 },
    rotationY = 0,
    { scale = 1 } = {}
) {
    const width = 1.2;
    const height = 2.0;
    const thickness = 0.01;

    return createProp(scene, physicsWorld, {
        name: 'TarotCards',
        position,
        rotation: rotationY,
        scale,
        colliders: CARDS.map((_, i) => ({
            type: 'box',
            halfExtents: [width / 2, thickness / 2, height / 2],
            offset: { x: i * 1.5, y: i * 0.002 },
        })),
        build({ group }) {
            const geometry = new THREE.BoxGeometry(width, thickness, height);

            CARDS.forEach((card, i) => {
                const material = new THREE.MeshStandardMaterial({
                    map: generateTarotTexture(card.name, card.number, card.color),
                    roughness: 0.6,
                    metalness: 0.1,
                });

                const cardMesh = new THREE.Mesh(geometry, material);
                cardMesh.castShadow = true;
                cardMesh.receiveShadow = true;
                cardMesh.position.set(i * 1.5, i * 0.002, 0);
                group.add(cardMesh);
            });
        },
    });
}
