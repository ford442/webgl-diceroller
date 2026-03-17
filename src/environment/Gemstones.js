import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getAmmo, createStaticBody } from '../physics.js';

export function createGemstones(scene, physicsWorld, position = { x: 6, y: -2.75, z: -5 }, rotation = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Gemstones';

    // Gem configurations: color, size, type, position offset
    const gemConfigs = [
        { type: 'ruby', color: 0xff0044, size: 0.25, x: -0.4, z: 0.2 },
        { type: 'sapphire', color: 0x0044ff, size: 0.22, x: 0.3, z: 0.4 },
        { type: 'emerald', color: 0x00ff44, size: 0.28, x: 0.5, z: -0.2 },
        { type: 'diamond', color: 0xffffff, size: 0.18, x: -0.2, z: -0.4 },
        { type: 'amethyst', color: 0x9932cc, size: 0.24, x: 0.1, z: 0.1 },
        { type: 'topaz', color: 0xffcc00, size: 0.2, x: -0.5, z: -0.1 },
        { type: 'opal', color: 0xe6f7ff, size: 0.19, x: 0.2, z: -0.5, isOpal: true }
    ];

    const gems = [];

    gemConfigs.forEach((config, index) => {
        const gem = createGem(config);
        
        // Random scatter position
        const scatterX = config.x + (Math.random() - 0.5) * 0.3;
        const scatterZ = config.z + (Math.random() - 0.5) * 0.3;
        const rotY = Math.random() * Math.PI * 2;
        const rotX = Math.random() * 0.5;
        const rotZ = Math.random() * 0.5;
        
        gem.position.set(scatterX, config.size * 0.6, scatterZ);
        gem.rotation.set(rotX, rotY, rotZ);
        
        gem.castShadow = true;
        gem.receiveShadow = true;
        
        // Store animation data
        gem.userData = {
            baseY: gem.position.y,
            offset: index * 0.5,
            rotationSpeed: 0.2 + Math.random() * 0.3
        };
        
        group.add(gem);
        gems.push(gem);

        // Physics for each gem
        const shape = new ammo.btBoxShape(new ammo.btVector3(config.size * 0.5, config.size * 0.4, config.size * 0.5));
        const dummy = new THREE.Object3D();
        dummy.position.copy(gem.position).applyEuler(group.rotation).add(group.position);
        dummy.rotation.copy(gem.rotation);
        dummy.position.y = group.position.y + config.size * 0.4;
        createStaticBody(physicsWorld, dummy, shape);
    });

    // Add a small velvet cloth underneath
    const clothGeo = new THREE.BoxGeometry(2.5, 0.02, 2.5);
    const clothMat = new THREE.MeshStandardMaterial({
        color: 0x4a0e0e,
        roughness: 0.9,
        metalness: 0.1
    });
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.y = 0.01;
    cloth.receiveShadow = true;
    group.add(cloth);

    // Position the entire group
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotation;
    scene.add(group);

    // Animation update function
    const updateGems = (time) => {
        gems.forEach(gem => {
            // Subtle shimmer - rotate slightly
            gem.rotation.y += gem.userData.rotationSpeed * 0.01;
            
            // Very subtle floating effect
            const floatY = Math.sin(time * 2 + gem.userData.offset) * 0.005;
            gem.position.y = gem.userData.baseY + floatY;
            
            // Sparkle effect - subtle emissive pulse
            if (gem.material.emissive) {
                const sparkle = 0.1 + Math.sin(time * 3 + gem.userData.offset) * 0.05;
                gem.material.emissiveIntensity = sparkle;
            }
        });
    };

    return { group, update: updateGems };
}

function createGem(config) {
    let geometry;
    
    // Different shapes for different gem types
    switch(config.type) {
        case 'ruby':
            // Diamond/Cut shape
            geometry = createDiamondGeometry(config.size);
            break;
        case 'sapphire':
            // Octahedron
            geometry = new THREE.OctahedronGeometry(config.size, 0);
            break;
        case 'emerald':
            // Box with bevel effect
            geometry = new THREE.BoxGeometry(config.size, config.size * 1.2, config.size);
            break;
        case 'diamond':
            // Double cone (brilliant cut)
            geometry = createBrilliantCut(config.size);
            break;
        case 'amethyst':
            // Dodecahedron
            geometry = new THREE.DodecahedronGeometry(config.size, 0);
            break;
        case 'topaz':
            // Cylinder cut
            geometry = new THREE.CylinderGeometry(config.size * 0.6, config.size * 0.8, config.size, 8);
            break;
        case 'opal':
            // Smooth sphere with special material
            geometry = new THREE.SphereGeometry(config.size * 0.8, 16, 16);
            break;
        default:
            geometry = new THREE.IcosahedronGeometry(config.size, 0);
    }

    // Create material with transmission for glass-like effect
    const material = new THREE.MeshPhysicalMaterial({
        color: config.color,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.6,
        thickness: 0.5,
        envMapIntensity: 1.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        ior: 1.5
    });

    // Special handling for opal's iridescence
    if (config.isOpal) {
        material.iridescence = 1.0;
        material.iridescenceIOR = 1.3;
        material.iridescenceThicknessRange = [100, 400];
        material.color = new THREE.Color(0xffffff);
    }

    // Add subtle emissive for sparkle effect
    material.emissive = new THREE.Color(config.color);
    material.emissiveIntensity = 0.1;

    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
}

function createDiamondGeometry(size) {
    // Create a diamond-shaped geometry (two pyramids base to base)
    const geometry = new THREE.ConeGeometry(size * 0.7, size, 4);
    const positions = geometry.attributes.position;
    
    // Mirror to create bottom half
    const bottomGeo = new THREE.ConeGeometry(size * 0.7, size * 0.6, 4);
    bottomGeo.rotateX(Math.PI);
    bottomGeo.translate(0, -size * 0.3, 0);
    
    // Merge geometries
    const merged = BufferGeometryUtils ? 
        BufferGeometryUtils.mergeGeometries([geometry, bottomGeo]) :
        mergeGeometriesManual(geometry, bottomGeo);
    
    return merged;
}

function createBrilliantCut(size) {
    // Create a brilliant cut diamond approximation
    const topGeo = new THREE.ConeGeometry(size * 0.8, size * 0.6, 8);
    const bottomGeo = new THREE.ConeGeometry(size * 0.4, size * 0.4, 8);
    bottomGeo.rotateX(Math.PI);
    bottomGeo.translate(0, -size * 0.2, 0);
    
    const merged = BufferGeometryUtils ? 
        BufferGeometryUtils.mergeGeometries([topGeo, bottomGeo]) :
        mergeGeometriesManual(topGeo, bottomGeo);
    
    return merged;
}

function mergeGeometriesManual(geo1, geo2) {
    // Simple merge without BufferGeometryUtils
    const count1 = geo1.attributes.position.count;
    const count2 = geo2.attributes.position.count;
    
    const positions = new Float32Array((count1 + count2) * 3);
    const normals = new Float32Array((count1 + count2) * 3);
    
    positions.set(geo1.attributes.position.array, 0);
    positions.set(geo2.attributes.position.array, count1 * 3);
    
    if (geo1.attributes.normal && geo2.attributes.normal) {
        normals.set(geo1.attributes.normal.array, 0);
        normals.set(geo2.attributes.normal.array, count1 * 3);
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeVertexNormals();
    
    return geometry;
}
