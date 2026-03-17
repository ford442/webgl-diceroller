import * as THREE from 'three';

/**
 * Creates magical floating candles that bob gently in the air
 * @param {THREE.Scene} scene - The Three.js scene
 * @returns {Object} Object containing the group and update function
 */
export function createFloatingCandles(scene) {
    const group = new THREE.Group();
    group.name = 'FloatingCandles';

    // Candle configuration - scattered around the table area
    const candleConfigs = [
        { x: -5, y: 3.5, z: -3, phase: 0, speed: 1.0 },
        { x: 6, y: 2.8, z: 2, phase: 1.5, speed: 0.8 },
        { x: -3, y: 3.2, z: 5, phase: 3.0, speed: 1.2 },
        { x: 4, y: 2.5, z: -5, phase: 4.5, speed: 0.9 },
        { x: 0, y: 4.0, z: 0, phase: 2.0, speed: 1.1 }
    ];

    const candles = [];
    const particles = [];

    // Materials
    const waxMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5dc, // Cream/off-white wax
        roughness: 0.6,
        metalness: 0.0
    });

    const wickMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.9
    });

    const flameCoreMaterial = new THREE.MeshBasicMaterial({
        color: 0xffaa00
    });

    const flameOuterMaterial = new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.6
    });

    // Create each floating candle
    candleConfigs.forEach((config, index) => {
        const candleGroup = new THREE.Group();
        
        // Candle dimensions
        const radius = 0.12;
        const height = 0.6;
        
        // Wax body
        const bodyGeo = new THREE.CylinderGeometry(radius, radius, height, 16);
        const bodyMesh = new THREE.Mesh(bodyGeo, waxMaterial);
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        candleGroup.add(bodyMesh);

        // Melted wax drips (visual detail)
        for (let i = 0; i < 3; i++) {
            const dripGeo = new THREE.SphereGeometry(0.04, 8, 8);
            const dripMesh = new THREE.Mesh(dripGeo, waxMaterial);
            const angle = (i / 3) * Math.PI * 2;
            dripMesh.position.set(
                Math.cos(angle) * radius * 0.9,
                height * 0.3 - Math.random() * 0.1,
                Math.sin(angle) * radius * 0.9
            );
            dripMesh.scale.y = 1.5;
            candleGroup.add(dripMesh);
        }

        // Wick
        const wickGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8);
        const wickMesh = new THREE.Mesh(wickGeo, wickMaterial);
        wickMesh.position.y = height / 2 + 0.04;
        candleGroup.add(wickMesh);

        // Flame (inner core)
        const flameCoreGeo = new THREE.SphereGeometry(0.05, 8, 8);
        const flameCore = new THREE.Mesh(flameCoreGeo, flameCoreMaterial);
        flameCore.position.y = height / 2 + 0.1;
        flameCore.scale.y = 1.5; // Elongated flame
        candleGroup.add(flameCore);

        // Flame (outer glow)
        const flameOuterGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const flameOuter = new THREE.Mesh(flameOuterGeo, flameOuterMaterial);
        flameOuter.position.y = height / 2 + 0.1;
        flameOuter.scale.y = 1.5;
        candleGroup.add(flameOuter);

        // Point light - warm orange glow
        const light = new THREE.PointLight(0xff9933, 1.5, 8);
        light.position.y = height / 2 + 0.15;
        light.castShadow = false; // Soft lighting, no hard shadows
        candleGroup.add(light);

        // Initial position
        candleGroup.position.set(config.x, config.y, config.z);
        
        // Random rotation for variety
        candleGroup.rotation.y = Math.random() * Math.PI * 2;
        candleGroup.rotation.z = (Math.random() - 0.5) * 0.1; // Slight tilt
        candleGroup.rotation.x = (Math.random() - 0.5) * 0.1;

        group.add(candleGroup);

        // Store for animation
        candles.push({
            group: candleGroup,
            baseY: config.y,
            phase: config.phase,
            speed: config.speed,
            light: light,
            flameCore: flameCore,
            flameOuter: flameOuter,
            wick: wickMesh
        });

        // Create wax drip particles for this candle
        const particleCount = 8;
        for (let i = 0; i < particleCount; i++) {
            const particleGeo = new THREE.SphereGeometry(0.02, 6, 6);
            const particleMat = new THREE.MeshBasicMaterial({
                color: 0xffdd88,
                transparent: true,
                opacity: 0.8
            });
            const particle = new THREE.Mesh(particleGeo, particleMat);
            
            particles.push({
                mesh: particle,
                candleIndex: index,
                active: false,
                life: 0,
                maxLife: 2 + Math.random() * 2,
                velocity: new THREE.Vector3()
            });
            
            group.add(particle);
        }
    });

    // Position the entire group relative to table
    // Table is at y = -2.75, we want candles floating above it
    group.position.set(0, 0, 0);

    scene.add(group);

    // Update function for animations
    const update = (deltaTime, time) => {
        // Animate each candle
        candles.forEach(candle => {
            // Bobbing motion (sine wave)
            const bobOffset = Math.sin(time * candle.speed + candle.phase) * 0.15;
            candle.group.position.y = candle.baseY + bobOffset;

            // Gentle swaying rotation
            candle.group.rotation.z = Math.sin(time * 0.5 + candle.phase) * 0.03;
            candle.group.rotation.x = Math.cos(time * 0.4 + candle.phase) * 0.03;

            // Flame flicker
            const flicker = 0.9 + Math.random() * 0.2;
            candle.light.intensity = 1.5 * flicker;
            
            // Flame size variation
            const flameScale = 1 + (Math.random() - 0.5) * 0.2;
            candle.flameCore.scale.setScalar(flameScale);
            candle.flameOuter.scale.set(1.2 * flameScale, 1.5 * flameScale, 1.2 * flameScale);

            // Light position jitter (flame movement)
            candle.light.position.x = (Math.random() - 0.5) * 0.02;
            candle.light.position.z = (Math.random() - 0.5) * 0.02;
        });

        // Animate wax drip particles
        particles.forEach(p => {
            if (!p.active) {
                // Random chance to activate
                if (Math.random() < 0.005) {
                    p.active = true;
                    p.life = 0;
                    
                    const candle = candles[p.candleIndex];
                    // Start at bottom of candle
                    p.mesh.position.copy(candle.group.position);
                    p.mesh.position.y -= 0.3; // Bottom of candle body
                    
                    // Initial velocity (falling with slight horizontal drift)
                    p.velocity.set(
                        (Math.random() - 0.5) * 0.1,
                        -0.2 - Math.random() * 0.2,
                        (Math.random() - 0.5) * 0.1
                    );
                    
                    p.mesh.visible = true;
                    p.mesh.material.opacity = 0.8;
                }
            } else {
                // Update falling particle
                p.life += deltaTime;
                
                // Apply velocity
                p.mesh.position.addScaledVector(p.velocity, deltaTime);
                
                // Gravity
                p.velocity.y -= 0.5 * deltaTime;
                
                // Fade out
                const lifeRatio = p.life / p.maxLife;
                p.mesh.material.opacity = 0.8 * (1 - lifeRatio);
                p.mesh.scale.setScalar(1 - lifeRatio * 0.5); // Shrink as it falls
                
                // Check if hit table or life expired
                if (p.life >= p.maxLife || p.mesh.position.y < -2.75) {
                    p.active = false;
                    p.mesh.visible = false;
                }
            }
        });
    };

    return {
        group,
        update
    };
}
