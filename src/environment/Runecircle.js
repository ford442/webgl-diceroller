import * as THREE from 'three';

/**
 * Creates a magical arcane runecircle on the floor beneath the table
 * @param {THREE.Scene} scene - The Three.js scene
 * @returns {Object} Object containing the group and update function
 */
export function createRunecircle(scene) {
    const group = new THREE.Group();
    group.name = 'Runecircle';

    // Configuration
    const outerRadius = 6;
    const innerRadius = 4.5;
    const runeCount = 12;
    
    // Magical color palette
    const primaryColor = 0x4488ff; // Mystical blue
    const secondaryColor = 0xaa44ff; // Magical purple
    const glowColor = 0x66aaff;

    // Materials
    const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        emissive: primaryColor,
        emissiveIntensity: 0.5,
        roughness: 0.4,
        metalness: 0.8,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });

    const runeMaterial = new THREE.MeshStandardMaterial({
        color: 0x88ccff,
        emissive: glowColor,
        emissiveIntensity: 1.0,
        roughness: 0.2,
        metalness: 0.9,
        transparent: true,
        opacity: 0.95
    });

    const innerCircleMaterial = new THREE.MeshStandardMaterial({
        color: 0x0a0a1a,
        emissive: secondaryColor,
        emissiveIntensity: 0.3,
        roughness: 0.6,
        metalness: 0.5,
        transparent: true,
        opacity: 0.8
    });

    // --- Main Ring ---
    const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 64);
    const ring = new THREE.Mesh(ringGeo, ringMaterial);
    ring.rotation.x = -Math.PI / 2; // Lay flat on floor
    ring.position.y = 0.02; // Slightly above floor to avoid z-fighting
    group.add(ring);

    // --- Inner Circle ---
    const innerCircleGeo = new THREE.CircleGeometry(innerRadius - 0.2, 64);
    const innerCircle = new THREE.Mesh(innerCircleGeo, innerCircleMaterial);
    innerCircle.rotation.x = -Math.PI / 2;
    innerCircle.position.y = 0.015;
    group.add(innerCircle);

    // --- Central Core ---
    const coreGeo = new THREE.CircleGeometry(1.5, 32);
    const coreMaterial = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: primaryColor,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.7
    });
    const core = new THREE.Mesh(coreGeo, coreMaterial);
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.025;
    group.add(core);

    // --- Decorative Pattern Rings ---
    const detailRing1 = new THREE.Mesh(
        new THREE.RingGeometry(outerRadius - 0.2, outerRadius - 0.1, 64),
        new THREE.MeshBasicMaterial({ 
            color: glowColor, 
            transparent: true, 
            opacity: 0.5,
            side: THREE.DoubleSide
        })
    );
    detailRing1.rotation.x = -Math.PI / 2;
    detailRing1.position.y = 0.03;
    group.add(detailRing1);

    const detailRing2 = new THREE.Mesh(
        new THREE.RingGeometry(innerRadius + 0.1, innerRadius + 0.2, 64),
        new THREE.MeshBasicMaterial({ 
            color: glowColor, 
            transparent: true, 
            opacity: 0.5,
            side: THREE.DoubleSide
        })
    );
    detailRing2.rotation.x = -Math.PI / 2;
    detailRing2.position.y = 0.03;
    group.add(detailRing2);

    // --- Rotating Runes ---
    const runes = [];
    const runeContainer = new THREE.Group();
    
    // Rune shapes - using various geometric primitives to represent magical symbols
    const runeGeometries = [
        // Rune 1: Diamond
        new THREE.ConeGeometry(0.25, 0.5, 4),
        // Rune 2: Hexagon
        new THREE.CylinderGeometry(0.2, 0.2, 0.1, 6),
        // Rune 3: Triangle
        new THREE.ConeGeometry(0.2, 0.4, 3),
        // Rune 4: Star (tetrahedron)
        new THREE.TetrahedronGeometry(0.25),
        // Rune 5: Octahedron
        new THREE.OctahedronGeometry(0.2),
        // Rune 6: Icosahedron
        new THREE.IcosahedronGeometry(0.2)
    ];

    for (let i = 0; i < runeCount; i++) {
        const angle = (i / runeCount) * Math.PI * 2;
        const radius = (innerRadius + outerRadius) / 2;
        
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        // Select geometry based on position
        const geoIndex = i % runeGeometries.length;
        const runeGeo = runeGeometries[geoIndex];
        
        const rune = new THREE.Mesh(runeGeo, runeMaterial.clone());
        
        // Position around the circle
        rune.position.set(x, 0.3, z);
        
        // Orient to face outward
        rune.lookAt(0, 0.3, 0);
        rune.rotateY(Math.PI); // Face outward
        
        // Add subtle floating animation offset
        rune.userData = {
            baseY: 0.3,
            phase: (i / runeCount) * Math.PI * 2,
            rotationSpeed: 0.5 + Math.random() * 0.5,
            floatSpeed: 1 + Math.random() * 0.5
        };
        
        runeContainer.add(rune);
        runes.push(rune);
    }
    
    group.add(runeContainer);

    // --- Additional Symbolic Elements ---
    
    // Inner rotating ring of smaller symbols
    const innerRunes = [];
    const innerRuneCount = 8;
    const innerRuneRadius = 2.5;
    
    for (let i = 0; i < innerRuneCount; i++) {
        const angle = (i / innerRuneCount) * Math.PI * 2;
        const x = Math.cos(angle) * innerRuneRadius;
        const z = Math.sin(angle) * innerRuneRadius;
        
        // Small glowing orbs
        const orbGeo = new THREE.SphereGeometry(0.15, 16, 16);
        const orbMat = new THREE.MeshStandardMaterial({
            color: secondaryColor,
            emissive: secondaryColor,
            emissiveIntensity: 2.0
        });
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.position.set(x, 0.2, z);
        
        orb.userData = {
            angle: angle,
            radius: innerRuneRadius,
            speed: -0.3 // Rotate opposite direction
        };
        
        group.add(orb);
        innerRunes.push(orb);
    }

    // --- Particle System for Rising Magic ---
    const particleCount = 30;
    const particles = [];
    const particleGeo = new THREE.PlaneGeometry(0.1, 0.1);
    const particleMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });

    for (let i = 0; i < particleCount; i++) {
        const particle = new THREE.Mesh(particleGeo, particleMat.clone());
        
        // Random position within inner circle
        const r = Math.random() * (innerRadius - 0.5);
        const theta = Math.random() * Math.PI * 2;
        
        particle.position.set(
            Math.cos(theta) * r,
            Math.random() * 2, // Start at various heights
            Math.sin(theta) * r
        );
        
        particle.userData = {
            speed: 0.2 + Math.random() * 0.4,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 1 + Math.random() * 2,
            maxHeight: 3 + Math.random() * 2
        };
        
        particle.visible = false;
        group.add(particle);
        particles.push(particle);
    }

    // --- Ambient Light from the Circle ---
    const ambientGlow = new THREE.PointLight(primaryColor, 0, 15);
    ambientGlow.position.set(0, 1, 0);
    group.add(ambientGlow);

    // Position on floor under the table
    // Table is at y = -2.75, so place circle slightly above floor
    group.position.set(0, -4.7, 0);

    scene.add(group);

    // Update function for animations
    const update = (deltaTime, time) => {
        // Pulsing glow effect
        const pulse = 0.7 + Math.sin(time * 1.5) * 0.3;
        
        // Update main ring emissive intensity
        ringMaterial.emissiveIntensity = 0.3 + pulse * 0.4;
        
        // Update core
        coreMaterial.emissiveIntensity = 0.5 + pulse * 0.5;
        
        // Update ambient light
        ambientGlow.intensity = 0.8 + pulse * 0.7;
        
        // Rotate rune container slowly
        runeContainer.rotation.y = time * 0.1;
        
        // Animate individual runes
        runes.forEach((rune, i) => {
            // Self-rotation
            rune.rotateY(deltaTime * rune.userData.rotationSpeed);
            rune.rotateZ(deltaTime * rune.userData.rotationSpeed * 0.5);
            
            // Floating bob
            const floatOffset = Math.sin(time * rune.userData.floatSpeed + rune.userData.phase) * 0.1;
            rune.position.y = rune.userData.baseY + floatOffset;
            
            // Pulsing emissive
            rune.material.emissiveIntensity = 0.8 + Math.sin(time * 2 + i) * 0.4;
        });
        
        // Rotate inner orbits
        innerRunes.forEach(orb => {
            orb.userData.angle += deltaTime * orb.userData.speed;
            orb.position.x = Math.cos(orb.userData.angle) * orb.userData.radius;
            orb.position.z = Math.sin(orb.userData.angle) * orb.userData.radius;
            
            // Vertical bob
            orb.position.y = 0.2 + Math.sin(time * 2 + orb.userData.angle) * 0.1;
        });
        
        // Animate particles
        particles.forEach((p, i) => {
            if (!p.visible) {
                // Random activation based on pulse
                if (Math.random() < 0.02 * pulse) {
                    p.visible = true;
                    // Reset to bottom
                    const r = Math.random() * (innerRadius - 0.5);
                    const theta = Math.random() * Math.PI * 2;
                    p.position.x = Math.cos(theta) * r;
                    p.position.z = Math.sin(theta) * r;
                    p.position.y = 0.1;
                    p.material.opacity = 0.6;
                }
            } else {
                // Rise up
                p.position.y += p.userData.speed * deltaTime;
                
                // Spiral motion
                p.userData.wobble += deltaTime * p.userData.wobbleSpeed;
                p.position.x += Math.sin(p.userData.wobble) * 0.01;
                p.position.z += Math.cos(p.userData.wobble) * 0.01;
                
                // Fade out near top
                const heightRatio = p.position.y / p.userData.maxHeight;
                p.material.opacity = 0.6 * (1 - heightRatio);
                p.rotation.z += deltaTime;
                
                // Reset if too high or faded
                if (p.position.y >= p.userData.maxHeight || p.material.opacity <= 0.05) {
                    p.visible = false;
                }
            }
        });
        
        // Rotate detail rings in opposite directions
        detailRing1.rotation.z = time * 0.05;
        detailRing2.rotation.z = -time * 0.03;
    };

    return {
        group,
        update
    };
}
