import * as THREE from 'three';
import { createStaticCollider } from '../../core/StaticColliderBridge.js';
import { TABLETOP_Y_OFFSET } from '../../core/SceneMetrics.js';
import { resolvePlacement } from './ClutterPlacement.js';

const tabletopY = (y) => y + TABLETOP_Y_OFFSET;
const randomUnit = (options) => (options?.rng ?? Math.random)();

function addBoxCollider(physicsWorld, anchor, halfExtents) {
    createStaticCollider(physicsWorld, anchor, { type: 'box', halfExtents });
}

function generateCharacterSheetTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f5deb3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#2c1b0e';
    ctx.font = 'bold 40px serif';
    ctx.fillText('CHARACTER SHEET', 80, 50);

    ctx.font = '24px serif';
    ctx.fillText('Name: __________________', 40, 100);
    ctx.fillText('Class: __________________', 40, 140);

    const startY = 200;
    const boxHeight = 60;
    const stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

    ctx.font = 'bold 24px serif';
    stats.forEach((stat, i) => {
        const y = startY + i * boxHeight;
        ctx.fillStyle = '#2c1b0e';
        ctx.fillText(stat, 40, y + 30);
        ctx.strokeRect(100, y, 60, 40);
        ctx.font = '20px monospace';
        const score = Math.floor(Math.random() * 8) + 10;
        ctx.fillText(score.toString(), 115, y + 27);
        ctx.font = 'bold 24px serif';
    });

    ctx.font = 'italic 16px serif';
    ctx.fillStyle = '#553311';
    ctx.fillText('Inventory:', 250, 200);
    ctx.fillText('- Longsword', 260, 230);
    ctx.fillText('- Rope (50ft)', 260, 260);
    ctx.fillText('- Rations', 260, 290);

    ctx.strokeStyle = 'rgba(80, 40, 0, 0.1)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(350, 500, 40, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createParchment(scene, physicsWorld, options = {}) {
    const width = 5;
    const depth = 7;
    const thickness = 0.02;
    const geometry = new THREE.BoxGeometry(width, thickness, depth);

    const texture = generateCharacterSheetTexture();

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.9,
        bumpScale: 0.01,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    const placement = resolvePlacement(options, { x: 4, z: -3 });
    mesh.position.set(placement.x, tabletopY(-2.74), placement.z);
    mesh.rotation.y = options.placement ? placement.rotationY : -0.3;
    scene.add(mesh);
    options.track?.(mesh);

    addBoxCollider(physicsWorld, mesh, [width / 2, thickness / 2, depth / 2]);
}

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

export function createTarotCards(scene, physicsWorld, options = {}) {
    const group = new THREE.Group();
    group.name = 'TarotCards';

    const width = 1.2;
    const height = 2.0;
    const thickness = 0.01;

    const geometry = new THREE.BoxGeometry(width, thickness, height);

    const cards = [
        { name: 'THE FOOL', number: '0', color: '#ffcc00' },
        { name: 'DEATH', number: 'XIII', color: '#333333' },
        { name: 'THE TOWER', number: 'XVI', color: '#8b0000' },
    ];

    const placement = resolvePlacement(options, { x: -7, z: 6 });
    const baseX = placement.x;
    const baseZ = placement.z;

    cards.forEach((card, i) => {
        const texture = generateTarotTexture(card.name, card.number, card.color);
        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.6,
            metalness: 0.1,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const x = baseX + i * 1.5 + (randomUnit(options) - 0.5) * 0.5;
        const z = baseZ + (randomUnit(options) - 0.5) * 0.5;
        const y = tabletopY(-2.745) + i * 0.002;

        mesh.position.set(x, y, z);
        mesh.rotation.y = (randomUnit(options) - 0.5) * 0.5;

        group.add(mesh);
        addBoxCollider(physicsWorld, mesh, [width / 2, thickness / 2, height / 2]);
    });

    scene.add(group);
    options.track?.(group);
}

function generateWantedPosterTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f5deb3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#2c1b0e';
    ctx.font = 'bold 80px serif';
    ctx.textAlign = 'center';
    ctx.fillText('WANTED', canvas.width / 2, 100);

    ctx.font = 'bold 40px serif';
    ctx.fillText('DEAD OR ALIVE', canvas.width / 2, 160);

    ctx.strokeRect(100, 200, 312, 300);
    ctx.fillStyle = '#000';
    ctx.fillRect(110, 210, 292, 280);

    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 300, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 550, 120, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(canvas.width / 2 - 30, 300, 10, 0, Math.PI * 2);
    ctx.arc(canvas.width / 2 + 30, 300, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2c1b0e';
    ctx.font = 'bold 60px serif';
    ctx.fillText('REWARD', canvas.width / 2, 580);
    ctx.font = 'bold 80px serif';
    ctx.fillText('10,000 GP', canvas.width / 2, 660);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createWantedPoster(scene, physicsWorld, options = {}) {
    const width = 2.5;
    const height = 3.5;
    const thickness = 0.02;

    const geometry = new THREE.BoxGeometry(width, thickness, height);

    const texture = generateWantedPosterTexture();
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0,
        color: 0xffffff,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    const placement = resolvePlacement(options, { x: 0, z: -2 });
    mesh.position.set(placement.x, tabletopY(-2.74), placement.z);
    mesh.rotation.y = options.placement ? placement.rotationY : 0.1;
    scene.add(mesh);
    options.track?.(mesh);

    addBoxCollider(physicsWorld, mesh, [width / 2, thickness / 2, height / 2]);
}
