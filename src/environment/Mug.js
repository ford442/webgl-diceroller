import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createMug(
    scene,
    physicsWorld,
    position = { x: 4, y: -2.75, z: 2 },
    rotationY = Math.PI / 4
) {
    const radius = 0.5;
    const height = 1.2;
    const thickness = 0.1;

    let innerMaterial;
    let steamGroup;

    const result = createProp(scene, physicsWorld, {
        name: 'EnhancedMug',
        position,
        rotation: rotationY,
        footOffsetY: height / 2,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
                materialTag: STATIC_MATERIAL.DEFAULT,
            },
        ],
        build({ group }) {
            const { diffuseMap, roughnessMap, bumpMap } = generateCeramicTextures();

            const clayMaterial = new THREE.MeshStandardMaterial({
                color: 0x8b5a2b,
                map: diffuseMap,
                roughnessMap,
                bumpMap,
                bumpScale: 0.02,
                roughness: 0.6,
                metalness: 0.05,
                envMapIntensity: 0.7,
            });

            innerMaterial = new THREE.MeshStandardMaterial({
                color: 0x3d2314,
                roughness: 0.85,
                metalness: 0.0,
                emissive: 0x2a1508,
                emissiveIntensity: 0.15,
            });

            const bodyMesh = mesh(
                new THREE.CylinderGeometry(radius, radius * 0.9, height, 32),
                clayMaterial
            );
            const innerRadius = radius - thickness;
            const innerDepth = height - thickness;
            const innerMesh = mesh(
                new THREE.CylinderGeometry(innerRadius, innerRadius * 0.88, innerDepth, 32),
                innerMaterial,
                { position: { y: thickness / 2 + 0.01 } }
            );
            bodyMesh.add(innerMesh);

            const handleRadius = 0.3;
            const handleTube = 0.09;
            const handleMesh = mesh(
                new THREE.TorusGeometry(handleRadius, handleTube, 16, 32),
                clayMaterial,
                { position: { x: radius + handleTube * 0.8 }, rotation: { y: Math.PI / 2 } }
            );

            group.add(bodyMesh);
            group.add(handleMesh);

            steamGroup = createSteamParticles();
            steamGroup.position.y = height / 2 + 0.05;
            group.add(steamGroup);
        },
    });

    function update(time) {
        steamGroup.children.forEach((particle) => {
            const userData = particle.userData;
            particle.position.y += userData.speed * 0.01;
            particle.position.x += Math.sin(time * userData.wiggleSpeed + userData.phase) * 0.002;
            particle.position.z += Math.cos(time * userData.wiggleSpeed + userData.phase) * 0.002;

            const lifeRatio = (particle.position.y - (height / 2 + 0.05)) / userData.maxHeight;
            particle.material.opacity = Math.max(0, 0.4 - lifeRatio * 0.4);
            particle.scale.setScalar(1 - lifeRatio * 0.5);

            if (
                particle.position.y > height / 2 + 0.05 + userData.maxHeight ||
                particle.material.opacity <= 0.01
            ) {
                particle.position.y = height / 2 + 0.05;
                particle.position.x = (Math.random() - 0.5) * 0.3;
                particle.position.z = (Math.random() - 0.5) * 0.3;
                particle.material.opacity = 0.4;
                particle.scale.setScalar(1);
            }
        });

        const pulse = 0.15 + Math.sin(time * 0.5) * 0.03;
        innerMaterial.emissiveIntensity = pulse;
    }

    return { ...result, update };
}

function generateCeramicTextures() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, 0, size, size);
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

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 30 + 20;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, '#444444');
        gradient.addColorStop(1, '#888888');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    const roughnessMap = new THREE.CanvasTexture(canvas);
    roughnessMap.colorSpace = THREE.NoColorSpace;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = Math.random() > 0.5 ? '#858585' : '#7b7b7b';
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, y, 2, 2);
    }
    const bumpMap = new THREE.CanvasTexture(canvas);
    bumpMap.colorSpace = THREE.NoColorSpace;

    return { diffuseMap, roughnessMap, bumpMap };
}

function createSteamParticles() {
    const group = new THREE.Group();
    const steamMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        roughness: 1.0,
        metalness: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    for (let i = 0; i < 8; i++) {
        const particle = mesh(new THREE.PlaneGeometry(0.15, 0.15), steamMaterial.clone());
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.25;
        particle.position.set(Math.cos(angle) * r, Math.random() * 0.5, Math.sin(angle) * r);
        particle.rotation.z = Math.random() * Math.PI;
        particle.userData = {
            speed: 0.5 + Math.random() * 0.5,
            wiggleSpeed: 1 + Math.random() * 2,
            phase: Math.random() * Math.PI * 2,
            maxHeight: 0.8 + Math.random() * 0.4,
        };
        group.add(particle);
    }

    return group;
}
