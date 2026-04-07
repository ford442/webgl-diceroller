import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createPlayingCards(scene, physicsWorld, position = { x: -8, y: -2.75, z: -8 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'PlayingCards';

    const ammo = getAmmo();

    // Dimensions for a standard playing card
    const width = 1.0;
    const height = 1.4;
    const thickness = 0.01;

    const geometry = new THREE.BoxGeometry(width, thickness, height);

    // Some scattered cards
    const cardsData = [
        { suit: '♠', rank: 'A', color: '#000000', angle: 0.2, dx: 0, dz: 0 },
        { suit: '♥', rank: 'K', color: '#cc0000', angle: -0.15, dx: 0.8, dz: -0.3 },
        { suit: '♣', rank: '7', color: '#000000', angle: 0.4, dx: -0.6, dz: 0.5 },
        { suit: '♦', rank: 'Q', color: '#cc0000', angle: -0.4, dx: 0.2, dz: 0.8 },
        { isBack: true, angle: 0.1, dx: -0.3, dz: -0.8 }, // Face down card
        { isBack: true, angle: -0.2, dx: 1.0, dz: 0.5 } // Another face down card
    ];

    // Base position on the table
    // Table Top -2.75.
    // Center Y = -2.75 + 0.005 = -2.745.
    const baseX = position.x;
    const baseZ = position.z;

    const backTexture = generateCardBackTexture();
    const backMaterial = new THREE.MeshStandardMaterial({
        map: backTexture,
        roughness: 0.6,
        metalness: 0.05
    });

    cardsData.forEach((card, i) => {
        let frontMaterial;
        if (card.isBack) {
            frontMaterial = backMaterial;
        } else {
            const frontTexture = generateCardFrontTexture(card.suit, card.rank, card.color);
            frontMaterial = new THREE.MeshStandardMaterial({
                map: frontTexture,
                roughness: 0.6,
                metalness: 0.05
            });
        }

        // Materials: 0: Right, 1: Left, 2: Top (face), 3: Bottom (back), 4: Front, 5: Back
        const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });

        let materials;
        if (card.isBack) {
            materials = [edgeMaterial, edgeMaterial, backMaterial, backMaterial, edgeMaterial, edgeMaterial];
        } else {
            materials = [edgeMaterial, edgeMaterial, frontMaterial, backMaterial, edgeMaterial, edgeMaterial];
        }

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const x = baseX + card.dx;
        const z = baseZ + card.dz;
        const y = -2.745 + (i * 0.002); // Stack slightly to avoid z-fighting

        mesh.position.set(x, y, z);
        mesh.rotation.y = card.angle;

        group.add(mesh);

        // Physics for each card
        const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, thickness/2, height/2));
        createStaticBody(physicsWorld, mesh, shape);
    });

    // Add a small deck
    const deckHeight = 0.2;
    const deckGeo = new THREE.BoxGeometry(width, deckHeight, height);

    // Create a material for the edges of the deck (looks like stacked paper)
    const deckEdgeCanvas = document.createElement('canvas');
    deckEdgeCanvas.width = 64;
    deckEdgeCanvas.height = 64;
    const edgeCtx = deckEdgeCanvas.getContext('2d');
    edgeCtx.fillStyle = '#f0f0f0';
    edgeCtx.fillRect(0, 0, 64, 64);
    edgeCtx.fillStyle = '#cccccc';
    for (let i = 0; i < 64; i += 4) {
        edgeCtx.fillRect(0, i, 64, 1);
    }
    const deckEdgeTexture = new THREE.CanvasTexture(deckEdgeCanvas);
    deckEdgeTexture.wrapS = THREE.RepeatWrapping;
    deckEdgeTexture.wrapT = THREE.RepeatWrapping;
    deckEdgeTexture.repeat.set(1, 4);

    const deckEdgeMaterial = new THREE.MeshStandardMaterial({
        map: deckEdgeTexture,
        roughness: 0.9
    });

    const deckMaterials = [deckEdgeMaterial, deckEdgeMaterial, backMaterial, backMaterial, deckEdgeMaterial, deckEdgeMaterial];
    const deckMesh = new THREE.Mesh(deckGeo, deckMaterials);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;

    // Deck position
    const deckX = baseX - 1.5;
    const deckZ = baseZ + 0.5;
    const deckY = -2.75 + deckHeight/2;
    deckMesh.position.set(deckX, deckY, deckZ);
    deckMesh.rotation.y = -0.3;

    group.add(deckMesh);
    const deckShape = new ammo.btBoxShape(new ammo.btVector3(width/2, deckHeight/2, height/2));
    createStaticBody(physicsWorld, deckMesh, deckShape);

    scene.add(group);

    return { group };
}

function generateCardFrontTexture(suit, rank, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 358;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = color;

    // Top-left rank and suit
    ctx.font = 'bold 36px serif';
    ctx.textAlign = 'center';
    ctx.fillText(rank, 30, 40);
    ctx.font = '36px serif';
    ctx.fillText(suit, 30, 75);

    // Bottom-right rank and suit (inverted)
    ctx.save();
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
    ctx.font = 'bold 36px serif';
    ctx.fillText(rank, 30, 40);
    ctx.font = '36px serif';
    ctx.fillText(suit, 30, 75);
    ctx.restore();

    // Center giant suit
    ctx.font = '120px serif';
    ctx.fillText(suit, canvas.width / 2, canvas.height / 2 + 40);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function generateCardBackTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 358;
    const ctx = canvas.getContext('2d');

    // White border
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Blue patterned back
    ctx.fillStyle = '#1122aa';
    ctx.fillRect(10, 10, canvas.width - 20, canvas.height - 20);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;

    // Draw some diamond patterns
    for (let y = 20; y < canvas.height - 20; y += 20) {
        for (let x = 20; x < canvas.width - 20; x += 20) {
            ctx.beginPath();
            ctx.moveTo(x + 10, y);
            ctx.lineTo(x + 20, y + 10);
            ctx.lineTo(x + 10, y + 20);
            ctx.lineTo(x, y + 10);
            ctx.closePath();
            ctx.stroke();
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
