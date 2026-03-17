import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

/**
 * Enhanced Chest with:
 * - Better PBR wood materials with normal/roughness maps
 * - Enhanced iron bands with proper metalness
 * - Subtle pulsing glow on the lock
 * - Detailed latch mechanism
 */
export function createChest(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    const group = new THREE.Group();
    group.name = 'EnhancedChest';

    // Dimensions
    const width = 1.6;  // X axis
    const depth = 1.0;  // Z axis
    const baseHeight = 0.8; // Y axis
    const lidHeight = 0.5; // Radius of cylinder part approx

    // ========== ENHANCED MATERIALS ==========
    
    const loader = new THREE.TextureLoader();
    
    // Load wood textures with error handling
    let woodDiffuse, woodBump, woodRoughness;
    try {
        woodDiffuse = loader.load('/images/wood_diffuse.jpg');
        woodBump = loader.load('/images/wood_bump.jpg');
        woodRoughness = loader.load('/images/wood_roughness.jpg');

        [woodDiffuse, woodBump, woodRoughness].forEach(t => {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.colorSpace = (t === woodDiffuse) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        });
    } catch (e) {
        console.warn('Could not load wood textures, using procedural fallback');
    }

    // Enhanced wood material
    const woodMat = new THREE.MeshStandardMaterial({
        map: woodDiffuse || generateWoodTexture(),
        bumpMap: woodBump,
        bumpScale: 0.08,
        roughnessMap: woodRoughness,
        color: 0x5c4033, // Dark Wood
        roughness: 0.75,
        metalness: 0.05,
        envMapIntensity: 0.6
    });

    // Enhanced iron material - dark, weathered metal
    const ironMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        metalness: 0.9,
        roughness: 0.55, // Slightly rough for weathered iron
        envMapIntensity: 0.8
    });

    // Gold lock material with emissive for magical treasure feel
    const lockMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        metalness: 1.0,
        roughness: 0.25,
        emissive: 0xffaa00,
        emissiveIntensity: 0.1,
        envMapIntensity: 1.2
    });

    // Hasp material - slightly darker iron
    const haspMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        metalness: 0.85,
        roughness: 0.6,
        envMapIntensity: 0.7
    });

    // ========== GEOMETRY ==========

    // 1. Base (Box)
    const baseGeo = new THREE.BoxGeometry(width, baseHeight, depth);
    const baseMesh = new THREE.Mesh(baseGeo, woodMat);
    // Position so bottom is at 0 (local). Center Y = baseHeight/2.
    baseMesh.position.y = baseHeight / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Lid (Rounded Top)
    const lidRadius = depth / 2;
    const lidGeo = new THREE.CylinderGeometry(lidRadius, lidRadius, width, 24, 1, false, 0, Math.PI);
    const lidMesh = new THREE.Mesh(lidGeo, woodMat);

    // Rotate to create dome shape
    lidMesh.rotation.z = -Math.PI / 2;
    lidMesh.rotation.x = -Math.PI / 2; // Orient dome up

    // Position: Top of base.
    lidMesh.position.y = baseHeight;
    lidMesh.castShadow = true;
    lidMesh.receiveShadow = true;
    group.add(lidMesh);

    // 3. Iron Bands (Reinforcements)
    const bandWidth = 0.18;
    const bandThickness = 0.06;

    const bandXOffsets = [-width/3, width/3];

    bandXOffsets.forEach(x => {
        // Base Band - slightly larger than chest
        const bandBaseGeo = new THREE.BoxGeometry(bandWidth, baseHeight, depth + bandThickness);
        const bandBase = new THREE.Mesh(bandBaseGeo, ironMat);
        bandBase.position.set(x, baseHeight/2, 0);
        bandBase.receiveShadow = true;
        bandBase.castShadow = true;
        group.add(bandBase);

        // Lid Band (Curved to match lid)
        const bandLidGeo = new THREE.CylinderGeometry(
            lidRadius + bandThickness/2, 
            lidRadius + bandThickness/2, 
            bandWidth, 
            24, 
            1, 
            false, 
            0, 
            Math.PI
        );
        const bandLid = new THREE.Mesh(bandLidGeo, ironMat);
        bandLid.rotation.z = -Math.PI / 2;
        bandLid.rotation.x = -Math.PI / 2;
        bandLid.position.set(x, baseHeight, 0);
        bandLid.castShadow = true;
        bandLid.receiveShadow = true;
        group.add(bandLid);
        
        // Band rivets
        for (let i = 0; i < 3; i++) {
            const rivetGeo = new THREE.SphereGeometry(0.03, 8, 8);
            const rivet = new THREE.Mesh(rivetGeo, ironMat);
            rivet.position.set(
                x, 
                baseHeight * (0.3 + i * 0.35), 
                depth/2 + bandThickness/2 + 0.02
            );
            group.add(rivet);
        }
    });

    // 4. Lock (Front Center)
    const lockGroup = new THREE.Group();
    
    // Main lock body
    const lockGeo = new THREE.BoxGeometry(0.25, 0.3, 0.12);
    const lock = new THREE.Mesh(lockGeo, lockMat);
    lock.castShadow = true;
    lock.receiveShadow = true;
    lockGroup.add(lock);
    
    // Keyhole
    const keyholeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8);
    const keyholeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const keyhole = new THREE.Mesh(keyholeGeo, keyholeMat);
    keyhole.rotation.x = Math.PI / 2;
    keyhole.position.set(0, -0.05, 0.061);
    lockGroup.add(keyhole);
    
    // Keyhole slit
    const slitGeo = new THREE.BoxGeometry(0.02, 0.08, 0.02);
    const slit = new THREE.Mesh(slitGeo, keyholeMat);
    slit.position.set(0, -0.1, 0.061);
    lockGroup.add(slit);

    // Position: Front face of base, near top.
    lockGroup.position.set(0, baseHeight - 0.22, depth/2 + 0.04);
    group.add(lockGroup);

    // 5. Lock Hasp (Lid part)
    const haspGroup = new THREE.Group();
    
    // Hasp plate
    const haspPlateGeo = new THREE.BoxGeometry(0.18, 0.25, 0.05);
    const haspPlate = new THREE.Mesh(haspPlateGeo, haspMat);
    haspGroup.add(haspPlate);
    
    // Hasp loop (goes over lock)
    const haspLoopGeo = new THREE.TorusGeometry(0.08, 0.025, 8, 16, Math.PI);
    const haspLoop = new THREE.Mesh(haspLoopGeo, haspMat);
    haspLoop.position.set(0, -0.12, 0.08);
    haspGroup.add(haspLoop);

    // Position: Bottom of lid front.
    haspGroup.position.set(0, baseHeight + 0.08, depth/2 + 0.02);
    group.add(haspGroup);

    // 6. Decorative corner protectors
    const cornerSize = 0.15;
    const cornerPositions = [
        { x: -width/2 + 0.05, z: -depth/2 + 0.05 },
        { x: width/2 - 0.05, z: -depth/2 + 0.05 },
        { x: -width/2 + 0.05, z: depth/2 - 0.05 },
        { x: width/2 - 0.05, z: depth/2 - 0.05 }
    ];

    cornerPositions.forEach(pos => {
        const cornerGeo = new THREE.BoxGeometry(cornerSize, baseHeight * 0.8, cornerSize);
        const corner = new THREE.Mesh(cornerGeo, ironMat);
        corner.position.set(pos.x, baseHeight * 0.5, pos.z);
        corner.castShadow = true;
        group.add(corner);
    });

    // ========== POSITION GROUP ==========
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;
    scene.add(group);

    // ========== PHYSICS ==========
    if (physicsWorld) {
        const ammo = getAmmo();
        // Static Box Shape enclosing base + lid
        // Total Height = baseHeight + lidRadius (0.8 + 0.5 = 1.3).
        // Center Y (relative to group origin): 1.3 / 2 = 0.65.
        // Group Origin is at bottom of chest.

        const totalHeight = baseHeight + lidRadius;
        const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, totalHeight/2, depth/2));

        // Create a proxy object for physics positioning (center of mass)
        const proxy = new THREE.Object3D();
        const offset = new THREE.Vector3(0, totalHeight/2, 0);

        proxy.position.copy(group.position).add(offset);
        proxy.quaternion.copy(group.quaternion);

        createStaticBody(physicsWorld, proxy, shape);
    }

    // ========== ANIMATION ==========
    
    function update(time) {
        // Subtle pulsing glow on the lock
        const pulse = 0.1 + Math.sin(time * 1.5) * 0.05;
        lockMat.emissiveIntensity = pulse;
    }

    return { 
        group,
        update
    };
}

/**
 * Procedural wood texture fallback
 */
function generateWoodTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Base wood color
    ctx.fillStyle = '#5c4033';
    ctx.fillRect(0, 0, 256, 256);

    // Draw grain lines
    ctx.strokeStyle = '#4a3328';
    ctx.lineWidth = 1;
    
    for (let i = 0; i < 30; i++) {
        ctx.beginPath();
        const x = Math.random() * 256;
        ctx.moveTo(x, 0);
        
        for (let y = 0; y < 256; y += 10) {
            const waveX = x + Math.sin(y * 0.02) * 5;
            ctx.lineTo(waveX, y);
        }
        
        ctx.globalAlpha = 0.3;
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}
