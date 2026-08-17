import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createBountyPoster(
    scene,
    physicsWorld,
    position = { x: -10, y: -2.75, z: -4 },
    rotationY = -Math.PI / 8
) {
    const width = 3.5;
    const length = 5;
    const thickness = 0.02;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 704;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#e6d5b8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(139, 69, 19, ${Math.random() * 0.1})`;
        ctx.beginPath();
        ctx.arc(
            Math.random() * canvas.width,
            Math.random() * canvas.height,
            Math.random() * 10 + 2,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    ctx.fillStyle = '#3a2f24';
    ctx.strokeStyle = '#3a2f24';
    ctx.lineWidth = 4;
    ctx.textAlign = 'center';

    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);
    ctx.strokeRect(35, 35, canvas.width - 70, canvas.height - 70);

    ctx.font = 'bold 64px serif';
    ctx.fillText('WANTED', canvas.width / 2, 110);
    ctx.font = 'italic 24px serif';
    ctx.fillText('DEAD OR ALIVE', canvas.width / 2, 140);

    ctx.beginPath();
    ctx.moveTo(80, 160);
    ctx.lineTo(canvas.width - 80, 160);
    ctx.stroke();

    ctx.save();
    ctx.translate(canvas.width / 2, 280);
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-50, -50);
    ctx.quadraticCurveTo(0, -80, 50, -50);
    ctx.lineTo(40, 40);
    ctx.quadraticCurveTo(0, 70, -40, 40);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-45, -20);
    ctx.lineTo(-90, -40);
    ctx.lineTo(-45, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(45, -20);
    ctx.lineTo(90, -40);
    ctx.lineTo(45, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-30, -10);
    ctx.lineTo(-10, 0);
    ctx.moveTo(30, -10);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillRect(-25, 5, 5, 5);
    ctx.fillRect(20, 5, 5, 5);

    ctx.beginPath();
    ctx.moveTo(-20, 30);
    ctx.quadraticCurveTo(0, 20, 20, 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, 28);
    ctx.lineTo(-5, 40);
    ctx.lineTo(0, 26);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-35, -55);
    ctx.lineTo(-45, -100);
    ctx.lineTo(-15, -70);
    ctx.lineTo(0, -110);
    ctx.lineTo(15, -70);
    ctx.lineTo(45, -100);
    ctx.lineTo(35, -55);
    ctx.stroke();

    ctx.restore();

    ctx.font = 'bold 36px serif';
    ctx.fillText('GRIMNAK', canvas.width / 2, 450);
    ctx.font = 'italic 28px serif';
    ctx.fillText('THE GOBLIN KING', canvas.width / 2, 490);

    ctx.font = '20px serif';
    ctx.fillText('For crimes against the crown:', canvas.width / 2, 540);
    ctx.font = 'italic 18px serif';
    ctx.fillText('Theft of the royal chalice,', canvas.width / 2, 570);
    ctx.fillText('arson, and general mischief.', canvas.width / 2, 595);

    ctx.font = 'bold 42px serif';
    ctx.fillText('REWARD: 5,000 gp', canvas.width / 2, 650);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0,
        color: 0xffffff,
    });

    return createProp(scene, physicsWorld, {
        name: 'BountyPoster',
        position,
        rotation: rotationY,
        footOffsetY: thickness / 2,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, thickness / 2, length / 2],
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            group.add(mesh(new THREE.BoxGeometry(width, thickness, length), material));
        },
    });
}
