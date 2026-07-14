import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

// Orb modes with colors and particle types
export const OrbMode = {
    ICE: 0,     // Blue - ice particles
    FIRE: 1,    // Red - ember particles
    NATURE: 2,  // Green - leaf particles
    ARCANE: 3   // Purple - magic sparkles
};

const MODE_COLORS = {
    [OrbMode.ICE]: { color: 0x44aaff, emissive: 0x1166cc, light: 0x4488ff },
    [OrbMode.FIRE]: { color: 0xff4422, emissive: 0xff1100, light: 0xff6622 },
    [OrbMode.NATURE]: { color: 0x44ff44, emissive: 0x22aa22, light: 0x66ff66 },
    [OrbMode.ARCANE]: { color: 0xaa44ff, emissive: 0x6600cc, light: 0xcc66ff }
};

const MODE_NAMES = {
    [OrbMode.ICE]: 'Ice',
    [OrbMode.FIRE]: 'Fire',
    [OrbMode.NATURE]: 'Nature',
    [OrbMode.ARCANE]: 'Arcane'
};

export function createMysticOrb(scene, physicsWorld, position = { x: 12, y: -2.75, z: 4 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'MysticOrb';

    // --- Materials ---
    const stoneMat = new THREE.MeshStandardMaterial({
        color: 0x444444,
        roughness: 0.9,
        metalness: 0.1
    });

    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        roughness: 0.3,
        metalness: 0.9
    });

    // Crystal material - will be updated with mode colors
    const crystalMat = new THREE.MeshPhysicalMaterial({
        color: MODE_COLORS[OrbMode.ICE].color,
        metalness: 0.1,
        roughness: 0.05,
        transmission: 0.7,
        thickness: 1.0,
        ior: 1.5,
        emissive: MODE_COLORS[OrbMode.ICE].emissive,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.9
    });

    // --- Pedestal Geometry ---
    const pedestalBaseRadius = 0.8;
    const pedestalBaseHeight = 0.2;
    const pedestalStemRadius = 0.3;
    const pedestalStemHeight = 1.0;
    const pedestalTopRadius = 0.5;
    const pedestalTopHeight = 0.15;

    // Base
    const baseGeo = new THREE.CylinderGeometry(pedestalBaseRadius, pedestalBaseRadius * 1.2, pedestalBaseHeight, 16);
    const base = new THREE.Mesh(baseGeo, stoneMat);
    base.position.y = pedestalBaseHeight / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Stem
    const stemGeo = new THREE.CylinderGeometry(pedestalStemRadius, pedestalStemRadius * 0.8, pedestalStemHeight, 12);
    const stem = new THREE.Mesh(stemGeo, stoneMat);
    stem.position.y = pedestalBaseHeight + pedestalStemHeight / 2;
    stem.castShadow = true;
    stem.receiveShadow = true;
    group.add(stem);

    // Decorative gold rings on stem
    const ringGeo = new THREE.TorusGeometry(pedestalStemRadius + 0.05, 0.04, 8, 16);
    const ring1 = new THREE.Mesh(ringGeo, goldMat);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = pedestalBaseHeight + pedestalStemHeight * 0.3;
    group.add(ring1);

    const ring2 = new THREE.Mesh(ringGeo, goldMat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = pedestalBaseHeight + pedestalStemHeight * 0.7;
    group.add(ring2);

    // Top platform
    const topGeo = new THREE.CylinderGeometry(pedestalTopRadius, pedestalStemRadius, pedestalTopHeight, 16);
    const top = new THREE.Mesh(topGeo, stoneMat);
    top.position.y = pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight / 2;
    top.castShadow = true;
    top.receiveShadow = true;
    group.add(top);

    // Gold rim on top
    const topRimGeo = new THREE.TorusGeometry(pedestalTopRadius, 0.05, 8, 24);
    const topRim = new THREE.Mesh(topRimGeo, goldMat);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight;
    group.add(topRim);

    // --- Floating Crystal Orb ---
    const orbRadius = 0.35;
    const orbGeo = new THREE.IcosahedronGeometry(orbRadius, 2);
    const orbMesh = new THREE.Mesh(orbGeo, crystalMat);
    orbMesh.position.y = pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight + orbRadius + 0.3;
    orbMesh.castShadow = true;
    group.add(orbMesh);

    // Inner glow core
    const coreGeo = new THREE.IcosahedronGeometry(orbRadius * 0.4, 0);
    const coreMat = new THREE.MeshBasicMaterial({
        color: MODE_COLORS[OrbMode.ICE].light,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.copy(orbMesh.position);
    group.add(coreMesh);

    // Point light
    const orbLight = new THREE.PointLight(MODE_COLORS[OrbMode.ICE].light, 3, 6);
    orbLight.position.copy(orbMesh.position);
    orbLight.castShadow = false;
    group.add(orbLight);

    // --- Positioning ---
    // Place on the table surface (table top is at Y = -2.75)
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics ---
    if (physicsWorld && getAmmo()) {
        const ammo = getAmmo();
        
        // Cylinder shape for the pedestal
        if (ammo && physicsWorld) {
            const pedestalShape = new ammo.btCylinderShape(
                new ammo.btVector3(pedestalBaseRadius, pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight, pedestalBaseRadius)
            );
            const pedestalPhysMesh = new THREE.Mesh(
                new THREE.CylinderGeometry(pedestalBaseRadius, pedestalBaseRadius, pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight, 16),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            pedestalPhysMesh.position.set(position.x, position.y + (pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight) / 2, position.z);
            scene.add(pedestalPhysMesh);
            createStaticBody(physicsWorld, pedestalPhysMesh, pedestalShape);
        }
    }

    // --- State ---
    let currentMode = OrbMode.ICE;
    let orbFloatOffset = 0;
    let orbRotationSpeed = 0.5;

    // --- Particle System ---
    const particleCount = 50;
    const particles = [];
    const particleGroup = new THREE.Group();
    group.add(particleGroup);

    // Create particle geometries for different modes
    const particleGeos = {
        [OrbMode.ICE]: new THREE.OctahedronGeometry(0.03, 0), // Crystal shards
        [OrbMode.FIRE]: new THREE.SphereGeometry(0.04, 6, 6),  // Ember spheres
        [OrbMode.NATURE]: new THREE.PlaneGeometry(0.06, 0.06), // Leaves
        [OrbMode.ARCANE]: new THREE.TetrahedronGeometry(0.03, 0) // Sparkles
    };

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
        const particle = {
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            life: Math.random(),
            maxLife: 1 + Math.random() * 2,
            size: 0.5 + Math.random() * 0.5,
            mesh: null
        };
        particles.push(particle);
    }

    const createParticleMeshes = () => {
        // Clear existing
        while (particleGroup.children.length > 0) {
            const child = particleGroup.children[0];
            particleGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        const geo = particleGeos[currentMode];
        const color = MODE_COLORS[currentMode].light;

        particles.forEach(p => {
            const mat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            });
            p.mesh = new THREE.Mesh(geo, mat);
            p.mesh.visible = false;
            particleGroup.add(p.mesh);
        });
    };

    createParticleMeshes();

    // --- Interaction ---
    const cycleMode = () => {
        currentMode = (currentMode + 1) % 4;
        const colors = MODE_COLORS[currentMode];

        // Update materials
        crystalMat.color.setHex(colors.color);
        crystalMat.emissive.setHex(colors.emissive);
        coreMat.color.setHex(colors.light);
        orbLight.color.setHex(colors.light);

        // Recreate particles with new style
        createParticleMeshes();

        // Burst effect - spawn particles immediately
        particles.forEach(p => {
            p.life = p.maxLife;
            resetParticle(p, true);
        });

        console.log(`[MysticOrb] Mode changed to: ${MODE_NAMES[currentMode]}`);
    };

    const resetParticle = (p, burst = false) => {
        // Start near the orb
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.3 + Math.random() * 0.2;
        const height = orbMesh.position.y + (Math.random() - 0.5) * 0.3;

        p.position.set(
            Math.cos(angle) * radius,
            height,
            Math.sin(angle) * radius
        );

        // Velocity based on mode
        switch (currentMode) {
            case OrbMode.ICE: // Fall down slowly
                p.velocity.set(
                    (Math.random() - 0.5) * 0.2,
                    burst ? (Math.random() - 0.3) * 0.5 : -0.1 - Math.random() * 0.2,
                    (Math.random() - 0.5) * 0.2
                );
                break;
            case OrbMode.FIRE: // Rise up
                p.velocity.set(
                    (Math.random() - 0.5) * 0.3,
                    burst ? (Math.random() + 0.2) * 0.5 : 0.1 + Math.random() * 0.3,
                    (Math.random() - 0.5) * 0.3
                );
                break;
            case OrbMode.NATURE: // Float and drift
                p.velocity.set(
                    (Math.random() - 0.5) * 0.4,
                    burst ? (Math.random() - 0.5) * 0.4 : (Math.random() - 0.5) * 0.2,
                    (Math.random() - 0.5) * 0.4
                );
                break;
            case OrbMode.ARCANE: // Spiral
                const spiralAngle = Math.random() * Math.PI * 2;
                p.velocity.set(
                    Math.cos(spiralAngle) * 0.3,
                    burst ? (Math.random() - 0.2) * 0.4 : 0.05 + Math.random() * 0.1,
                    Math.sin(spiralAngle) * 0.3
                );
                break;
        }

        p.life = p.maxLife;
        if (p.mesh) {
            p.mesh.visible = true;
            p.mesh.material.opacity = 0.8;
        }
    };

    const updateParticles = (deltaTime) => {
        particles.forEach(p => {
            if (!p.mesh) return;

            if (p.life <= 0) {
                resetParticle(p);
            }

            // Update position
            p.position.addScaledVector(p.velocity, deltaTime);
            p.life -= deltaTime;

            // Mode-specific movement
            if (currentMode === OrbMode.ARCANE && p.life > 0) {
                // Spiral motion
                const time = performance.now() / 1000;
                p.position.x += Math.cos(time * 3 + p.life) * 0.01;
                p.position.z += Math.sin(time * 3 + p.life) * 0.01;
            } else if (currentMode === OrbMode.NATURE && p.life > 0) {
                // Gentle floating with rotation
                p.mesh.rotation.x += deltaTime;
                p.mesh.rotation.y += deltaTime * 0.5;
            }

            // Update mesh
            p.mesh.position.copy(p.position);
            p.mesh.scale.setScalar(p.size * (p.life / p.maxLife));
            p.mesh.material.opacity = 0.8 * (p.life / p.maxLife);
        });
    };

    // --- Update Loop ---
    const update = (deltaTime, elapsedTime) => {
        // Float the orb
        orbFloatOffset += deltaTime;
        const floatY = Math.sin(orbFloatOffset * 1.5) * 0.05;
        orbMesh.position.y = pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight + orbRadius + 0.3 + floatY;
        coreMesh.position.copy(orbMesh.position);
        orbLight.position.copy(orbMesh.position);

        // Rotate the orb
        orbMesh.rotation.y += deltaTime * orbRotationSpeed;
        orbMesh.rotation.x = Math.sin(elapsedTime * 0.5) * 0.1;
        coreMesh.rotation.copy(orbMesh.rotation);

        // Update particles
        updateParticles(deltaTime);
    };

    const getMode = () => currentMode;
    const getModeName = () => MODE_NAMES[currentMode];

    return {
        group,
        interact: cycleMode,
        update,
        getMode,
        getModeName,
        OrbMode
    };
}
