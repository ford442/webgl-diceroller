import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createGemstones(
    scene,
    physicsWorld,
    position = { x: 6, y: -2.75, z: -5 },
    rotation = 0
) {
    const gemConfigs = [
        { type: 'ruby', color: 0xff0044, size: 0.25, x: -0.4, z: 0.2 },
        { type: 'sapphire', color: 0x0044ff, size: 0.22, x: 0.3, z: 0.4 },
        { type: 'emerald', color: 0x00ff44, size: 0.28, x: 0.5, z: -0.2 },
        { type: 'diamond', color: 0xffffff, size: 0.18, x: -0.2, z: -0.4 },
        { type: 'amethyst', color: 0x9932cc, size: 0.24, x: 0.1, z: 0.1 },
        { type: 'topaz', color: 0xffcc00, size: 0.2, x: -0.5, z: -0.1 },
        { type: 'opal', color: 0xe6f7ff, size: 0.19, x: 0.2, z: -0.5, isOpal: true },
    ];

    const gems = [];
    const colliders = gemConfigs.map((config) => {
        const scatterX = config.x + (Math.random() - 0.5) * 0.3;
        const scatterZ = config.z + (Math.random() - 0.5) * 0.3;
        config._scatterX = scatterX;
        config._scatterZ = scatterZ;
        return {
            type: 'box',
            halfExtents: [config.size * 0.5, config.size * 0.4, config.size * 0.5],
            offset: { x: scatterX, y: config.size * 0.4, z: scatterZ },
            materialTag: STATIC_MATERIAL.DEFAULT,
        };
    });

    colliders.push({
        type: 'box',
        halfExtents: [1.25, 0.01, 1.25],
        offset: { y: 0.01 },
        materialTag: STATIC_MATERIAL.VELVET,
    });

    const result = createProp(scene, physicsWorld, {
        name: 'Gemstones',
        position,
        rotation,
        colliders,
        build({ group }) {
            gemConfigs.forEach((config, index) => {
                const gem = createGem(config);
                const rotY = Math.random() * Math.PI * 2;
                const rotX = Math.random() * 0.5;
                const rotZ = Math.random() * 0.5;

                gem.position.set(config._scatterX, config.size * 0.6, config._scatterZ);
                gem.rotation.set(rotX, rotY, rotZ);
                gem.userData = {
                    baseY: gem.position.y,
                    offset: index * 0.5,
                    rotationSpeed: 0.2 + Math.random() * 0.3,
                };
                group.add(gem);
                gems.push(gem);
            });

            const clothMat = new THREE.MeshStandardMaterial({
                color: 0x4a0e0e,
                roughness: 0.9,
                metalness: 0.1,
            });
            group.add(
                mesh(new THREE.BoxGeometry(2.5, 0.02, 2.5), clothMat, {
                    position: { y: 0.01 },
                })
            );
        },
    });

    const updateGems = (time) => {
        gems.forEach((gem) => {
            gem.rotation.y += gem.userData.rotationSpeed * 0.01;
            const floatY = Math.sin(time * 2 + gem.userData.offset) * 0.005;
            gem.position.y = gem.userData.baseY + floatY;
            if (gem.material.emissive) {
                const sparkle = 0.1 + Math.sin(time * 3 + gem.userData.offset) * 0.05;
                gem.material.emissiveIntensity = sparkle;
            }
        });
    };

    return { ...result, update: updateGems };
}

function createGem(config) {
    let geometry;

    switch (config.type) {
        case 'ruby':
            geometry = createDiamondGeometry(config.size);
            break;
        case 'sapphire':
            geometry = new THREE.OctahedronGeometry(config.size, 0);
            break;
        case 'emerald':
            geometry = new THREE.BoxGeometry(config.size, config.size * 1.2, config.size);
            break;
        case 'diamond':
            geometry = createBrilliantCut(config.size);
            break;
        case 'amethyst':
            geometry = new THREE.DodecahedronGeometry(config.size, 0);
            break;
        case 'topaz':
            geometry = new THREE.CylinderGeometry(
                config.size * 0.6,
                config.size * 0.8,
                config.size,
                8
            );
            break;
        case 'opal':
            geometry = new THREE.SphereGeometry(config.size * 0.8, 16, 16);
            break;
        default:
            geometry = new THREE.IcosahedronGeometry(config.size, 0);
    }

    const material = new THREE.MeshPhysicalMaterial({
        color: config.color,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.6,
        thickness: 0.5,
        envMapIntensity: 1.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        ior: 1.5,
    });

    if (config.isOpal) {
        material.color = new THREE.Color(0xffffff);
        material.emissive = new THREE.Color(0x88ccff);
        material.emissiveIntensity = 0.2;
        material.dispersion = 0.5;
    }

    material.emissive = new THREE.Color(config.color);
    material.emissiveIntensity = 0.1;

    return mesh(geometry, material);
}

function createDiamondGeometry(size) {
    const geometry = new THREE.ConeGeometry(size * 0.7, size, 4);
    const bottomGeo = new THREE.ConeGeometry(size * 0.7, size * 0.6, 4);
    bottomGeo.rotateX(Math.PI);
    bottomGeo.translate(0, -size * 0.3, 0);

    return BufferGeometryUtils
        ? BufferGeometryUtils.mergeGeometries([geometry, bottomGeo])
        : mergeGeometriesManual(geometry, bottomGeo);
}

function createBrilliantCut(size) {
    const topGeo = new THREE.ConeGeometry(size * 0.8, size * 0.6, 8);
    const bottomGeo = new THREE.ConeGeometry(size * 0.4, size * 0.4, 8);
    bottomGeo.rotateX(Math.PI);
    bottomGeo.translate(0, -size * 0.2, 0);

    return BufferGeometryUtils
        ? BufferGeometryUtils.mergeGeometries([topGeo, bottomGeo])
        : mergeGeometriesManual(topGeo, bottomGeo);
}

function mergeGeometriesManual(geo1, geo2) {
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
