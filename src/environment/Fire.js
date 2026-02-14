import * as THREE from 'three';

// Procedurally generate a fire texture
const fireTexture = createFireTexture();

export function createFire(options = {}) {
    const scale = options.scale || 1.0;
    const color = options.color || 0xff5500; // Orange-red base
    const particleCount = options.particleCount || 50;
    const height = options.height || 1.0;
    const spread = options.spread || 0.2;

    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const lifetimes = []; // 0 to 1
    const velocities = []; // Upward speed + horizontal drift

    for (let i = 0; i < particleCount; i++) {
        // Initial random position at base
        positions.push(
            (Math.random() - 0.5) * spread * scale,
            (Math.random() * 0.2) * scale, // Start low
            (Math.random() - 0.5) * spread * scale
        );

        // Random lifetime (offset start time)
        lifetimes.push(Math.random());

        // Random velocity
        velocities.push(
            (Math.random() - 0.5) * 0.5 * scale, // X drift
            (1.0 + Math.random()) * scale,       // Y speed
            (Math.random() - 0.5) * 0.5 * scale  // Z drift
        );
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // Store simulation data in userData so we don't need custom attributes in shader (CPU update)
    // Actually, storing them in arrays is easier for CPU update
    const particleData = {
        lifetimes: lifetimes,
        velocities: velocities,
        initialPositions: [...positions] // Clone
    };

    const material = new THREE.PointsMaterial({
        color: color,
        size: 0.5 * scale,
        map: fireTexture,
        transparent: true,
        opacity: 0.8,
        depthWrite: false, // Don't occlude other particles
        blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Points(geometry, material);

    // Update function
    const update = (deltaTime) => {
        const positions = geometry.attributes.position.array;

        for (let i = 0; i < particleCount; i++) {
            let life = particleData.lifetimes[i];

            // Advance life
            life += deltaTime * 1.5; // Speed of cycle

            if (life > 1.0) {
                life = 0; // Reset
                // Reset position to base
                positions[i*3] = (Math.random() - 0.5) * spread * scale * 0.5;
                positions[i*3+1] = (Math.random() * 0.1) * scale;
                positions[i*3+2] = (Math.random() - 0.5) * spread * scale * 0.5;
            }

            particleData.lifetimes[i] = life;

            // Move particle up
            // Y = Initial + Velocity * Life
            // Add some noise/wiggle based on height

            const vX = particleData.velocities[i*3];
            const vY = particleData.velocities[i*3+1];
            const vZ = particleData.velocities[i*3+2];

            // Simple integration
            positions[i*3] += vX * deltaTime;
            positions[i*3+1] += vY * deltaTime;
            positions[i*3+2] += vZ * deltaTime;

            // Fade/Shrink logic could be done in shader or by updating size/opacity attribute
            // For PointsMaterial, size is uniform. Opacity is uniform.
            // If we want per-particle fade, we need custom shader or vertex colors/alphas.

            // Let's use vertex colors for fading!
            // But PointsMaterial uses vertexColors: true if we set it.
        }

        geometry.attributes.position.needsUpdate = true;
    };

    // To handle per-particle fading, let's upgrade material to use vertex colors.
    material.vertexColors = true;
    // Initialize colors
    const colors = [];
    const baseColor = new THREE.Color(color);
    for(let i=0; i<particleCount; i++) {
        colors.push(baseColor.r, baseColor.g, baseColor.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Enhanced Update with Color Fading
    const enhancedUpdate = (deltaTime) => {
        const positions = geometry.attributes.position.array;
        const colors = geometry.attributes.color.array;

        for (let i = 0; i < particleCount; i++) {
            let life = particleData.lifetimes[i];
            life += deltaTime * (0.5 + Math.random() * 0.5); // Random speed

            if (life > 1.0) {
                life = 0;
                // Reset pos
                positions[i*3] = (Math.random() - 0.5) * spread * scale * 0.5;
                positions[i*3+1] = (Math.random() * 0.1) * scale;
                positions[i*3+2] = (Math.random() - 0.5) * spread * scale * 0.5;
            }
            particleData.lifetimes[i] = life;

            // Move up
            const speedY = particleData.velocities[i*3+1];
            positions[i*3+1] += speedY * deltaTime;

            // Wiggle (X/Z)
            // Sine wave based on height and time
            const wiggle = Math.sin(positions[i*3+1] * 5.0 + performance.now() * 0.005) * 0.01 * scale;
            positions[i*3] += wiggle;
            positions[i*3+2] += wiggle;

            // Color Fade: Yellow -> Red -> Dark
            // Life 0.0 - 0.2: Yellow/White (Hot)
            // Life 0.2 - 0.6: Orange
            // Life 0.6 - 1.0: Red/Black (Cool)

            const r = baseColor.r;
            const g = baseColor.g * (1.0 - life); // Green drops -> Red
            const b = baseColor.b * (1.0 - life * 2.0); // Blue drops fast -> Yellow

            // Alpha hack: dim color to simulate fade (since opacity is global in PointsMaterial without custom shader)
            // But we use AdditiveBlending, so Black = Transparent.
            const brightness = 1.0 - Math.pow(life, 2); // Quadratic fade out

            colors[i*3] = r * brightness;
            colors[i*3+1] = Math.max(0, g * brightness);
            colors[i*3+2] = Math.max(0, b * brightness);
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
    };

    return { mesh, update: enhancedUpdate };
}

function createFireTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)'); // Hot center
    grad.addColorStop(0.4, 'rgba(255, 200, 0, 0.8)'); // Yellow body
    grad.addColorStop(1, 'rgba(255, 0, 0, 0)'); // Red fade out

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
