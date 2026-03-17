import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

/**
 * Enhanced Mug with:
 * - Better PBR materials (roughness/metalness maps via procedural generation)
 * - Emissive warm interior for "warm drink" feel
 * - Subtle steam particle animation
 */
export function createMug(scene, physicsWorld, position = { x: 4, y: -2.75, z: 2 }, rotationY = Math.PI / 4) {
    const mugGroup = new THREE.Group();
    mugGroup.name = 'EnhancedMug';

    // Dimensions
    const radius = 0.5;
    const height = 1.2;
    const thickness = 0.1;

    // ========== ENHANCED MATERIALS ==========

    // Generate procedural textures for better PBR
    const { diffuseMap, roughnessMap, bumpMap } = generateCeramicTextures();

    // Outer ceramic material - warm brown clay
    const clayMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b5a2b,         // Dark brown clay/ceramic
        map: diffuseMap,
        roughnessMap: roughnessMap,
        bumpMap: bumpMap,
        bumpScale: 0.02,
        roughness: 0.6,          // Base roughness (modulated by map)
        metalness: 0.05,         // Slight metalness for ceramic glaze
        envMapIntensity: 0.7
    });

    // Inner material - darker with warm emissive for "hot drink" feel
    const innerMaterial = new THREE.MeshStandardMaterial({
        color: 0x3d2314,         // Darker inside
        roughness: 0.85,
        metalness: 0.0,
        emissive: 0x2a1508,      // Subtle warm glow
        emissiveIntensity: 0.15
    });

    // Handle wood material
    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a3728,
        roughness: 0.7,
        metalness: 0.0
    });

    // ========== GEOMETRY ==========

    // 1. Mug Body (Outer)
    const bodyGeometry = new THREE.CylinderGeometry(radius, radius * 0.9, height, 32);
    const bodyMesh = new THREE.Mesh(bodyGeometry, clayMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;

    // 2. Mug Inner (to make it look hollow)
    const innerRadius = radius - thickness;
    const innerDepth = height - thickness;
    const innerGeometry = new THREE.CylinderGeometry(innerRadius, innerRadius * 0.88, innerDepth, 32);
    const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial);
    innerMesh.position.y = thickness / 2 + 0.01; // slightly up to prevent z-fighting at bottom
    bodyMesh.add(innerMesh);

    // 3. Mug Handle
    const handleRadius = 0.3;
    const handleTube = 0.09;
    const handleGeometry = new THREE.TorusGeometry(handleRadius, handleTube, 16, 32);
    const handleMesh = new THREE.Mesh(handleGeometry, clayMaterial);

    // Position the handle on the side
    handleMesh.position.set(radius + handleTube * 0.8, 0, 0);
    // Rotate so it's vertically aligned
    handleMesh.rotation.y = Math.PI / 2;
    handleMesh.castShadow = true;
    handleMesh.receiveShadow = true;

    // Assemble
    mugGroup.add(bodyMesh);
    mugGroup.add(handleMesh);

    // ========== STEAM PARTICLES ==========
    
    const steamGroup = createSteamParticles();
    steamGroup.position.y = height / 2 + 0.05;
    mugGroup.add(steamGroup);

    // ========== POSITIONING ==========

    // The cylinder center is at its middle (y = 0), so we shift it up by height/2
    // position.y should be the bottom of the mug resting on the table.
    mugGroup.position.set(position.x, position.y + height / 2, position.z);
    mugGroup.rotation.y = rotationY;

    // Add to scene
    scene.add(mugGroup);

    // ========== PHYSICS ==========

    const Ammo = getAmmo();
    if (Ammo && physicsWorld) {
        // We'll use a simple cylinder shape for the collision bounds
        const shape = new Ammo.btCylinderShape(new Ammo.btVector3(radius, height / 2, radius));

        // Use the mugGroup for transformation
        const body = createStaticBody(physicsWorld, mugGroup, shape);

        // Store body reference
        mugGroup.userData.body = body;
    }

    // ========== ANIMATION UPDATE ==========
    
    function update(time) {
        // Animate steam particles
        steamGroup.children.forEach((particle, i) => {
            const userData = particle.userData;
            
            // Move up
            particle.position.y += userData.speed * 0.01;
            
            // Wiggle
            particle.position.x += Math.sin(time * userData.wiggleSpeed + userData.phase) * 0.002;
            particle.position.z += Math.cos(time * userData.wiggleSpeed + userData.phase) * 0.002;
            
            // Fade out as it goes up
            const lifeRatio = (particle.position.y - (height / 2 + 0.05)) / userData.maxHeight;
            particle.material.opacity = Math.max(0, 0.4 - lifeRatio * 0.4);
            
            // Scale down slightly
            const scale = 1 - lifeRatio * 0.5;
            particle.scale.setScalar(scale);
            
            // Reset if too high or invisible
            if (particle.position.y > height / 2 + 0.05 + userData.maxHeight || particle.material.opacity <= 0.01) {
                particle.position.y = height / 2 + 0.05;
                particle.position.x = (Math.random() - 0.5) * 0.3;
                particle.position.z = (Math.random() - 0.5) * 0.3;
                particle.material.opacity = 0.4;
                particle.scale.setScalar(1);
            }
        });
        
        // Subtle emissive pulse for warmth
        const pulse = 0.15 + Math.sin(time * 0.5) * 0.03;
        innerMaterial.emissiveIntensity = pulse;
    }

    return { 
        group: mugGroup,
        update
    };
}

/**
 * Generates procedural ceramic textures for PBR
 */
function generateCeramicTextures() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Diffuse map - base color with slight variation
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, 0, size, size);
    
    // Add subtle color variation
    for (let i = 0; i < 100; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 2 + 1;
        ctx.fillStyle = Math.random() > 0.5 ? '#7a4f25' : '#9c6531';
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const diffuseMap = new THREE.CanvasTexture(canvas);
    diffuseMap.colorSpace = THREE.SRGBColorSpace;
    
    // Roughness map - ceramic is smoother in glaze areas
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#888888'; // Mid-gray roughness
    ctx.fillRect(0, 0, size, size);
    
    // Add darker (smoother) areas for glaze effect
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 30 + 20;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, '#444444'); // Smooth
        gradient.addColorStop(1, '#888888'); // Base
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    
    const roughnessMap = new THREE.CanvasTexture(canvas);
    roughnessMap.colorSpace = THREE.NoColorSpace;

    // Bump map - subtle surface variation
    ctx.fillStyle = '#808080'; // Mid-gray = no displacement
    ctx.fillRect(0, 0, size, size);
    
    // Add noise for surface imperfections
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const val = Math.random() > 0.5 ? '#858585' : '#7b7b7b';
        ctx.fillStyle = val;
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, y, 2, 2);
    }
    
    const bumpMap = new THREE.CanvasTexture(canvas);
    bumpMap.colorSpace = THREE.NoColorSpace;

    return { diffuseMap, roughnessMap, bumpMap };
}

/**
 * Creates steam particle system for the mug
 */
function createSteamParticles() {
    const group = new THREE.Group();
    const particleCount = 8;
    
    // Steam material - soft, semi-transparent white
    const steamMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        roughness: 1.0,
        metalness: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    for (let i = 0; i < particleCount; i++) {
        // Soft circular particle
        const geometry = new THREE.PlaneGeometry(0.15, 0.15);
        const particle = new THREE.Mesh(geometry, steamMaterial.clone());
        
        // Random starting position within mug
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.25;
        particle.position.set(
            Math.cos(angle) * r,
            Math.random() * 0.5,
            Math.sin(angle) * r
        );
        
        // Random rotation for variety
        particle.rotation.z = Math.random() * Math.PI;
        
        // Store animation data
        particle.userData = {
            speed: 0.5 + Math.random() * 0.5,
            wiggleSpeed: 1 + Math.random() * 2,
            phase: Math.random() * Math.PI * 2,
            maxHeight: 0.8 + Math.random() * 0.4
        };
        
        group.add(particle);
    }
    
    return group;
}
