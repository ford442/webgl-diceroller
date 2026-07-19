import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';
import { registerInteractable } from '../interactables/InteractableRegistry.js';
import { tween } from '../interactables/tween.js';

const SUITS = [
    { suit: '♠', color: '#000000' },
    { suit: '♥', color: '#cc0000' },
    { suit: '♣', color: '#000000' },
    { suit: '♦', color: '#cc0000' }
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createPlayingCards(scene, physicsWorld, position = { x: -8, y: -2.75, z: -8 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'PlayingCards';

    const ammo = getAmmo();
    const cards = []; // interactive scattered cards, populated below

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
        cards.push({ mesh, baseRotX: mesh.rotation.x, flipped: false, isBack: !!card.isBack });

        // Physics for each card
        if (ammo && physicsWorld) {
            const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, thickness/2, height/2));
            createStaticBody(physicsWorld, mesh, shape);
        }
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
    if (ammo && physicsWorld) {
        const deckShape = new ammo.btBoxShape(new ammo.btVector3(width/2, deckHeight/2, height/2));
        createStaticBody(physicsWorld, deckMesh, deckShape);
    }

    scene.add(group);

    // --- Interaction: each click "draws" the next card — flips it with a little
    // hop and reveals a fresh random face, so the cards feel playable rather than
    // static. Clicking a face-up card flips it back down. ---
    let cursor = 0;
    let draws = 0;
    let lastCard = null;
    const animating = new Set();

    const drawRandom = () => {
        const s = SUITS[Math.floor(Math.random() * SUITS.length)];
        const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
        return { rank, suit: s.suit, color: s.color };
    };

    const flipCard = (entry) => {
        if (!entry || animating.has(entry)) return null;
        animating.add(entry);
        const revealing = !entry.flipped;
        let revealed = null;

        // When revealing, swap in a freshly drawn face texture (dispose the old).
        if (revealing) {
            revealed = drawRandom();
            lastCard = revealed;
            const tex = generateCardFrontTexture(revealed.suit, revealed.rank, revealed.color);
            const newFront = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.05 });
            const mats = entry.mesh.material;
            const old = mats[2];
            mats[2] = newFront;
            if (old && old.map && old !== mats[3]) { old.map.dispose?.(); old.dispose?.(); }
        }

        const from = entry.mesh.rotation.x;
        const to = from + Math.PI;
        const baseY = entry.mesh.position.y;
        tween({
            duration: 360,
            onUpdate: (e) => {
                entry.mesh.rotation.x = from + (to - from) * e;
                entry.mesh.position.y = baseY + Math.sin(e * Math.PI) * 0.25; // hop
            },
            onComplete: () => {
                entry.mesh.rotation.x = to % (Math.PI * 2);
                entry.mesh.position.y = baseY;
                entry.flipped = !entry.flipped;
                animating.delete(entry);
            }
        });
        return revealed;
    };

    const interact = () => {
        if (cards.length === 0) return;
        draws++;
        const entry = cards[cursor % cards.length];
        cursor++;
        flipCard(entry);
    };

    registerInteractable('playingCards', {
        trigger: interact,
        flip: (index) => flipCard(cards[index]),
        getState: () => ({ draws, lastCard, cardCount: cards.length })
    });

    return {
        group,
        interact,
        dispose: () => { /* interactable handle is shared/overwritten across spawns */ }
    };
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
