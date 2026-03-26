import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createBountyPoster(scene, physicsWorld) {
    const width = 3.5;
    const length = 5;
    const thickness = 0.02;

    // Create procedural canvas texture for the bounty poster
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 704; // ~ 8.5x11 ratio
    const ctx = canvas.getContext('2d');

    // Background (old weathered parchment color)
    ctx.fillStyle = '#e6d5b8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add some "grime" to the parchment
    for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(139, 69, 19, ${Math.random() * 0.1})`;
        ctx.beginPath();
        ctx.arc(
            Math.random() * canvas.width,
            Math.random() * canvas.height,
            Math.random() * 10 + 2,
            0, Math.PI * 2
        );
        ctx.fill();
    }

    // Set drawing style
    ctx.fillStyle = '#3a2f24';
    ctx.strokeStyle = '#3a2f24';
    ctx.lineWidth = 4;
    ctx.textAlign = 'center';

    // Border
    ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);
    ctx.strokeRect(35, 35, canvas.width - 70, canvas.height - 70);

    // "WANTED" Header
    ctx.font = 'bold 64px serif';
    ctx.fillText('WANTED', canvas.width / 2, 110);
    ctx.font = 'italic 24px serif';
    ctx.fillText('DEAD OR ALIVE', canvas.width / 2, 140);

    // Separator line
    ctx.beginPath();
    ctx.moveTo(80, 160);
    ctx.lineTo(canvas.width - 80, 160);
    ctx.stroke();

    // Draw the target "Goblin King"
    // Using simple path shapes for a rough sketch look
    ctx.save();
    ctx.translate(canvas.width / 2, 280);
    ctx.lineWidth = 3;

    // Head shape
    ctx.beginPath();
    ctx.moveTo(-50, -50);
    ctx.quadraticCurveTo(0, -80, 50, -50);
    ctx.lineTo(40, 40);
    ctx.quadraticCurveTo(0, 70, -40, 40);
    ctx.closePath();
    ctx.stroke();

    // Ears
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

    // Eyes (angry)
    ctx.beginPath();
    ctx.moveTo(-30, -10);
    ctx.lineTo(-10, 0);
    ctx.moveTo(30, -10);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillRect(-25, 5, 5, 5);
    ctx.fillRect(20, 5, 5, 5);

    // Mouth
    ctx.beginPath();
    ctx.moveTo(-20, 30);
    ctx.quadraticCurveTo(0, 20, 20, 30);
    ctx.stroke();
    // Tooth
    ctx.beginPath();
    ctx.moveTo(-10, 28);
    ctx.lineTo(-5, 40);
    ctx.lineTo(0, 26);
    ctx.stroke();

    // Crown
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

    // Target Name
    ctx.font = 'bold 36px serif';
    ctx.fillText('GRIMNAK', canvas.width / 2, 450);
    ctx.font = 'italic 28px serif';
    ctx.fillText('THE GOBLIN KING', canvas.width / 2, 490);

    // Crime description
    ctx.font = '20px serif';
    ctx.fillText('For crimes against the crown:', canvas.width / 2, 540);
    ctx.font = 'italic 18px serif';
    ctx.fillText('Theft of the royal chalice,', canvas.width / 2, 570);
    ctx.fillText('arson, and general mischief.', canvas.width / 2, 595);

    // Reward
    ctx.font = 'bold 42px serif';
    ctx.fillText('REWARD: 5,000 gp', canvas.width / 2, 650);


    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    // Material
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9, // Paper is rough
        metalness: 0.0,
        color: 0xffffff
    });

    const geometry = new THREE.BoxGeometry(width, thickness, length);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'BountyPoster';

    // Position on table (table surface is Y = -2.75)
    // Placed slightly off to the side, maybe overlapping with the character sheet or separate
    mesh.position.set(-6, -2.75 + thickness/2, 1);

    // Rotation so it faces the "player" mostly, but casually angled
    mesh.rotation.y = -Math.PI / 8;

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    scene.add(mesh);

    // Physics
    const Ammo = getAmmo();
    if (Ammo) {
        // Simple box shape for the paper
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(width / 2, thickness / 2, length / 2));
        createStaticBody(physicsWorld, mesh, shape);
    }

    return { group: mesh };
}
