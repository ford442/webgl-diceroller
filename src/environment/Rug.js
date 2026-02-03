import * as THREE from 'three';

export function createRug(scene) {
    const width = 24;
    const depth = 32;
    const thickness = 0.05;

    // Texture
    const texture = generateRugTexture();

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.1,
        bumpMap: texture, // Use same pattern for bump
        bumpScale: 0.05,
        color: 0xdddddd // Slightly dim
    });

    const geometry = new THREE.BoxGeometry(width, thickness, depth);
    const rug = new THREE.Mesh(geometry, material);

    // Position
    // Floor (TavernWalls) is center -10, height 1. Top surface at -9.5.
    // Rug center Y = -9.5 + thickness/2 = -9.475.
    rug.position.set(0, -9.475, 0);
    rug.receiveShadow = true;

    scene.add(rug);
}

function generateRugTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    const w = canvas.width;
    const h = canvas.height;

    // Base Color (Deep Red)
    ctx.fillStyle = '#4a0404';
    ctx.fillRect(0, 0, w, h);

    // Inner Rectangle (Pattern Area)
    const border = 100;
    ctx.fillStyle = '#6e0b0b';
    ctx.fillRect(border, border, w - border*2, h - border*2);

    // Gold/Beige Border Lines
    ctx.strokeStyle = '#cba135';
    ctx.lineWidth = 20;
    ctx.strokeRect(border/2, border/2, w - border, h - border);

    ctx.lineWidth = 5;
    ctx.strokeRect(border + 10, border + 10, w - border*2 - 20, h - border*2 - 20);

    // Central Pattern (Diamond)
    ctx.save();
    ctx.translate(w/2, h/2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#220000';
    const diaSize = 300;
    ctx.fillRect(-diaSize/2, -diaSize/2, diaSize, diaSize);

    // Inner Diamond
    ctx.fillStyle = '#884444';
    const innerDia = 200;
    ctx.fillRect(-innerDia/2, -innerDia/2, innerDia, innerDia);
    ctx.restore();

    // Corner Patterns
    const cornerSize = 80;
    ctx.fillStyle = '#1a1a00';
    // TL
    ctx.fillRect(border, border, cornerSize, cornerSize);
    // TR
    ctx.fillRect(w - border - cornerSize, border, cornerSize, cornerSize);
    // BL
    ctx.fillRect(border, h - border - cornerSize, cornerSize, cornerSize);
    // BR
    ctx.fillRect(w - border - cornerSize, h - border - cornerSize, cornerSize, cornerSize);

    // Noise/Fray effect (simple dots)
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for(let i=0; i<5000; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillRect(x, y, 2, 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    return texture;
}
