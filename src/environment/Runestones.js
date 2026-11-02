import * as THREE from 'three';
import { createProp, propRng } from './propKit.js';

export function createRunestones(
    scene,
    physicsWorld,
    position = { x: 10, y: -2.75, z: -10 },
    _rotationY = 0
) {
    // Claimed up front: the collider layout below is drawn from it, and createProp
    // reuses it instead of claiming a second stream.
    const rng = propRng('Runestones');
    const radius = 0.15;
    const height = 0.05;
    const numStones = 5;
    const runeColors = ['#00ffff', '#ff00ff', '#ffff00', '#00ff00', '#ff8800'];
    const baseX = position.x;
    const baseZ = position.z;
    const baseY = position.y + height / 2;

    const stones = Array.from({ length: numStones }, (_, i) => ({
        offsetX: (rng() - 0.5) * 1.5,
        offsetZ: (rng() - 0.5) * 1.5,
        y: baseY + i * 0.001,
        rotY: rng() * Math.PI * 2,
        runeColor: runeColors[i % runeColors.length],
    }));

    const result = createProp(scene, physicsWorld, {
        name: 'Runestones',
        rng,
        colliders: stones.map((stone) => ({
            type: 'cylinder',
            radius,
            halfHeight: height / 2,
            offset: { x: baseX + stone.offsetX, y: stone.y, z: baseZ + stone.offsetZ },
            rotation: { y: stone.rotY },
        })),
        build({ group }) {
            stones.forEach((stone) => {
                const texture = generateRuneTexture(stone.runeColor, rng);
                const stoneMat = new THREE.MeshStandardMaterial({
                    color: 0x333333,
                    roughness: 0.8,
                    metalness: 0.1,
                });
                const runeMat = new THREE.MeshStandardMaterial({
                    map: texture,
                    emissiveMap: texture,
                    emissive: new THREE.Color(stone.runeColor),
                    emissiveIntensity: 1.5,
                    color: 0x333333,
                    roughness: 0.6,
                    metalness: 0.2,
                });
                const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 6), [
                    stoneMat,
                    runeMat,
                    stoneMat,
                ]);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.position.set(baseX + stone.offsetX, stone.y, baseZ + stone.offsetZ);
                mesh.rotation.y = stone.rotY;
                group.add(mesh);
            });
        },
    });

    return result.group;
}

function generateRuneTexture(glowColor, rng) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 128, 128);

    for (let i = 0; i < 500; i++) {
        const x = rng() * 128;
        const y = rng() * 128;
        const c = Math.floor(rng() * 30 + 10);
        ctx.fillStyle = `rgb(${c},${c},${c})`;
        ctx.fillRect(x, y, 2, 2);
    }

    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let cx = 64 + (rng() - 0.5) * 20;
    let cy = 64 + (rng() - 0.5) * 20;
    ctx.moveTo(cx, cy);
    const segments = Math.floor(rng() * 3) + 3;
    for (let s = 0; s < segments; s++) {
        cx += (rng() - 0.5) * 60;
        cy += (rng() - 0.5) * 60;
        cx = Math.max(30, Math.min(98, cx));
        cy = Math.max(30, Math.min(98, cy));
        ctx.lineTo(cx, cy);
    }
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
