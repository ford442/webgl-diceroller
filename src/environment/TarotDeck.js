import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { toCurrentTabletopY } from '../core/SceneMetrics.js';

export function createTarotDeck(scene, physicsWorld, position = { x: -6, y: -2.74, z: -3 }, rotationY = Math.PI / 6) {
    position = toCurrentTabletopY(position);
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    group.name = 'TarotDeck';

    // Standard tarot card dimensions
    const cardWidth = 1.4;
    const cardHeight = 2.4;
    const cardThickness = 0.01;
    const deckThickness = 0.5;

    // Generate Textures
    const backTexture = generateCardBackTexture();
    const faceTexture = generateTheFoolTexture();
    const edgeColor = 0xe0d6c8; // Aged paper edge

    // Materials
    const backMaterial = new THREE.MeshStandardMaterial({
        map: backTexture,
        roughness: 0.8,
        metalness: 0.1,
        color: 0xffffff
    });

    const faceMaterial = new THREE.MeshStandardMaterial({
        map: faceTexture,
        roughness: 0.8,
        metalness: 0.1,
        color: 0xffffff
    });

    const edgeMaterial = new THREE.MeshStandardMaterial({
        color: edgeColor,
        roughness: 0.9,
        metalness: 0.0
    });

    // Materials array for BoxGeometry
    // 0: Right (+x), 1: Left (-x), 2: Top (+y), 3: Bottom (-y), 4: Front (+z), 5: Back (-z)

    // 1. The Deck (Stack of cards)
    const deckGeometry = new THREE.BoxGeometry(cardWidth, deckThickness, cardHeight);

    // Top of deck is card back (+y), bottom is face (-y) but hidden
    // Front/back/sides are edges
    const deckMaterials = [
        edgeMaterial, // Right
        edgeMaterial, // Left
        backMaterial, // Top
        edgeMaterial, // Bottom
        edgeMaterial, // Front
        edgeMaterial  // Back
    ];

    const deckMesh = new THREE.Mesh(deckGeometry, deckMaterials);
    // Position deck resting on table. Center Y = thickness / 2
    deckMesh.position.set(0, deckThickness / 2, 0);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    group.add(deckMesh);

    // Physics for Deck
    if (physicsWorld && getAmmo()) {
        if (ammo && physicsWorld) {
            const deckShape = new ammo.btBoxShape(new ammo.btVector3(cardWidth / 2, deckThickness / 2, cardHeight / 2));
    
            // createStaticBody expects the object to have the world transform.
            // We'll create a dummy mesh with the world transform of the deckMesh
            const deckDummy = new THREE.Mesh();
    
            // Calculate world position
            const deckWorldPos = new THREE.Vector3(0, deckThickness / 2, 0);
            deckWorldPos.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
            deckWorldPos.add(new THREE.Vector3(position.x, position.y, position.z));
    
            deckDummy.position.copy(deckWorldPos);
            deckDummy.quaternion.copy(group.quaternion);
    
            createStaticBody(physicsWorld, deckDummy, deckShape);
        }
    }

    // 2. A scattered card face up (The Fool)
    const cardGeometry = new THREE.BoxGeometry(cardWidth, cardThickness, cardHeight);

    const faceUpMaterials = [
        edgeMaterial, // Right
        edgeMaterial, // Left
        faceMaterial, // Top (Face up)
        backMaterial, // Bottom
        edgeMaterial, // Front
        edgeMaterial  // Back
    ];

    const card1 = new THREE.Mesh(cardGeometry, faceUpMaterials);
    // Positioned beside the deck
    card1.position.set(2.0, cardThickness / 2, 0.5);
    card1.rotation.y = -Math.PI / 8;
    card1.castShadow = true;
    card1.receiveShadow = true;
    group.add(card1);

    // Physics for Card 1
    if (physicsWorld && getAmmo()) {
        if (ammo && physicsWorld) {
            const cardShape = new ammo.btBoxShape(new ammo.btVector3(cardWidth / 2, cardThickness / 2, cardHeight / 2));
    
            const cardDummy = new THREE.Mesh();
            const cardWorldPos = new THREE.Vector3(2.0, cardThickness / 2, 0.5);
    
            // Apply group rotation
            cardWorldPos.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
            cardWorldPos.add(new THREE.Vector3(position.x, position.y, position.z));
    
            cardDummy.position.copy(cardWorldPos);
    
            // Combine group rotation and local card rotation
            const euler = new THREE.Euler(0, rotationY - Math.PI / 8, 0, 'YXZ');
            cardDummy.quaternion.setFromEuler(euler);
    
            createStaticBody(physicsWorld, cardDummy, cardShape);
        }
    }

    // 3. A scattered card face down
    const faceDownMaterials = [
        edgeMaterial, // Right
        edgeMaterial, // Left
        backMaterial, // Top (Face down)
        faceMaterial, // Bottom
        edgeMaterial, // Front
        edgeMaterial  // Back
    ];

    const card2 = new THREE.Mesh(cardGeometry, faceDownMaterials);
    // Positioned partly under the deck or nearby
    card2.position.set(1.0, cardThickness / 2, -1.5);
    card2.rotation.y = Math.PI / 12;
    card2.castShadow = true;
    card2.receiveShadow = true;
    group.add(card2);

    // Physics for Card 2
    if (physicsWorld && getAmmo()) {
        if (ammo && physicsWorld) {
            const cardShape = new ammo.btBoxShape(new ammo.btVector3(cardWidth / 2, cardThickness / 2, cardHeight / 2));
    
            const cardDummy = new THREE.Mesh();
            const cardWorldPos = new THREE.Vector3(1.0, cardThickness / 2, -1.5);
    
            // Apply group rotation
            cardWorldPos.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
            cardWorldPos.add(new THREE.Vector3(position.x, position.y, position.z));
    
            cardDummy.position.copy(cardWorldPos);
    
            const euler = new THREE.Euler(0, rotationY + Math.PI / 12, 0, 'YXZ');
            cardDummy.quaternion.setFromEuler(euler);
    
            createStaticBody(physicsWorld, cardDummy, cardShape);
        }
    }

    scene.add(group);

    return {
        group
    };
}

function generateCardBackTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base color (dark blue/purple)
    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = '#d4af37'; // Gold
    ctx.lineWidth = 8;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

    // Inner Border
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);

    // Center Mandala/Eye design
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.strokeStyle = '#d4af37';

    // Outer circle
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.stroke();

    // Inner circle
    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.stroke();

    // Star/Rays
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 / 8) * i;
        ctx.moveTo(cx + Math.cos(angle) * 40, cy + Math.sin(angle) * 40);
        ctx.lineTo(cx + Math.cos(angle) * 80, cy + Math.sin(angle) * 80);
    }
    ctx.stroke();

    // The All-Seeing Eye
    ctx.beginPath();
    ctx.ellipse(cx, cy, 25, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#d4af37';
    ctx.fill();

    // Add some wear and tear
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 100; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Rotate texture if needed to match geometry orientation
    // texture.rotation = -Math.PI / 2;
    // texture.center.set(0.5, 0.5);
    return texture;
}

function generateTheFoolTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base color (aged parchment)
    ctx.fillStyle = '#e8dcc5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

    // Number
    ctx.fillStyle = '#222';
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.fillText('0', canvas.width / 2, 50);

    // Title
    ctx.font = 'bold 28px serif';
    ctx.fillText('THE FOOL', canvas.width / 2, canvas.height - 30);

    // Art (Simplified Fool: Cliff, Sun, Figure)
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Sun
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(cx + 60, cy - 100, 30, 0, Math.PI * 2);
    ctx.fill();

    // Cliff edge
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.moveTo(16, cy + 120);
    ctx.lineTo(cx + 40, cy + 60);
    ctx.lineTo(cx + 40, canvas.height - 60);
    ctx.lineTo(16, canvas.height - 60);
    ctx.fill();

    // Figure
    ctx.fillStyle = '#c44'; // Tunic
    ctx.fillRect(cx - 30, cy - 60, 40, 80);

    // Head
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(cx - 10, cy - 80, 20, 0, Math.PI * 2);
    ctx.fill();

    // Legs stepping off
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy + 20);
    ctx.lineTo(cx - 30, cy + 80); // Standing leg
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy + 20);
    ctx.lineTo(cx + 30, cy + 60); // Stepping off leg
    ctx.stroke();

    // Bindlestiff (stick + bag)
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

    // Dog
    ctx.fillStyle = '#aaa';
    ctx.fillRect(cx - 80, cy + 40, 40, 30);

    // Aging effect
    ctx.fillStyle = 'rgba(139, 69, 19, 0.1)';
    for (let i = 0; i < 50; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 20 + 5, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Rotate texture if needed to match geometry orientation
    texture.rotation = Math.PI / 2;
    texture.center.set(0.5, 0.5);
    return texture;
}
