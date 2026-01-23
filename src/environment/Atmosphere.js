import * as THREE from 'three';

let dustParticles;

export function createAtmosphere(scene) {
    const particleCount = 300;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = []; // Random seed for independent movement

    // Volume around the table
    // Table is roughly 20x20 centered at 0.
    // Room Height is around -10 to +10.
    // We want particles visible near the candle and table.

    for (let i = 0; i < particleCount; i++) {
        const x = (Math.random() - 0.5) * 30;
        const y = (Math.random() - 0.5) * 20; // -10 to 10
        const z = (Math.random() - 0.5) * 30;
        positions.push(x, y, z);

        // Random drift params (0-1)
        velocities.push(Math.random(), Math.random(), Math.random());
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const texture = createDustTexture();

    const material = new THREE.PointsMaterial({
        color: 0xffcc88, // Warm dust
        size: 0.2,
        map: texture,
        transparent: true,
        opacity: 0.4,
        alphaTest: 0.01,
        depthWrite: false, // Don't occlude
        blending: THREE.AdditiveBlending
    });

    dustParticles = new THREE.Points(geometry, material);

    // Store velocities in userData for update function
    dustParticles.userData = { velocities: velocities };

    scene.add(dustParticles);

    return dustParticles;
}

export function updateAtmosphere(time) {
    if (!dustParticles) return;

    const positions = dustParticles.geometry.attributes.position.array;
    const velocities = dustParticles.userData.velocities;

    for (let i = 0; i < positions.length / 3; i++) {
        const i3 = i * 3;

        // Organic movement using Sine waves
        // Use velocities (random seeds) to offset phases
        const v1 = velocities[i*3];
        const v2 = velocities[i*3+1];
        const v3 = velocities[i*3+2];

        // X: Gentle drift
        positions[i3] += Math.sin(time * 0.2 + v1 * 10) * 0.005;

        // Y: Slight updraft (heat) + float
        positions[i3+1] += Math.cos(time * 0.1 + v2 * 10) * 0.005 + 0.002;

        // Z: Gentle drift
        positions[i3+2] += Math.sin(time * 0.15 + v3 * 10) * 0.005;

        // Wrap around bounds
        // If it goes too high, reset to bottom
        if (positions[i3+1] > 12) positions[i3+1] = -12;
        // If it goes too low (rare), reset to top
        if (positions[i3+1] < -12) positions[i3+1] = 12;
    }

    dustParticles.geometry.attributes.position.needsUpdate = true;
}

function createDustTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    // Soft radial glow
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
