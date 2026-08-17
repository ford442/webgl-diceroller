import * as THREE from 'three';
import { playPropImpact } from '../audio/DiceCollisionAudio.js';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCauldron(
    scene,
    physicsWorld,
    position = { x: 12, y: -2.75, z: -4 },
    rotation = 0
) {
    const radius = 1.2;
    const legHeight = 0.8;
    const centerHeight = legHeight + radius;
    const thetaStart = Math.PI * 0.25;
    const thetaLength = Math.PI - thetaStart;
    const rimRadius = Math.sin(thetaStart) * radius;
    const rimHeight = centerHeight + Math.cos(thetaStart) * radius;
    const totalHeight = rimHeight;
    const physRadius = radius + 0.1;

    const castIronMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.8,
        metalness: 0.6,
        bumpScale: 0.05,
    });

    const liquidMat = new THREE.MeshStandardMaterial({
        color: 0x22ff22,
        emissive: 0x11aa11,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.9,
    });

    let glowLight;
    let liquid;
    const _impactPos = new THREE.Vector3();
    const liquidHeight = rimHeight - 0.2;
    const baseLiquidY = liquidHeight;
    let timeOffset = Math.random() * 100;
    let bubbleTime = 0;

    const result = createProp(scene, physicsWorld, {
        name: 'Cauldron',
        position,
        rotation,
        colliders: [
            {
                type: 'cylinder',
                radius: physRadius,
                halfHeight: totalHeight / 2,
                offset: { y: totalHeight / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const bodyGeo = new THREE.SphereGeometry(
                radius,
                32,
                16,
                0,
                Math.PI * 2,
                thetaStart,
                thetaLength
            );
            group.add(mesh(bodyGeo, castIronMat, { position: { y: centerHeight } }));

            const rimGeo = new THREE.TorusGeometry(rimRadius, 0.1, 16, 32);
            group.add(
                mesh(rimGeo, castIronMat, {
                    position: { y: rimHeight },
                    rotation: { x: Math.PI / 2 },
                })
            );

            const legRadius = 0.1;
            const legGeo = new THREE.CylinderGeometry(legRadius * 0.5, legRadius, legHeight, 8);
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const attachmentAngle = Math.PI * 0.8;
                const attachmentRadius = Math.sin(attachmentAngle) * radius;

                const leg = mesh(legGeo, castIronMat, {
                    position: {
                        x: Math.cos(angle) * attachmentRadius,
                        y: legHeight / 2,
                        z: Math.sin(angle) * attachmentRadius,
                    },
                });
                leg.lookAt(
                    new THREE.Vector3(
                        Math.cos(angle) * radius * 2,
                        legHeight / 2,
                        Math.sin(angle) * radius * 2
                    )
                );
                leg.rotateX(Math.PI / 2);
                leg.rotateX(-Math.PI / 6);
                group.add(leg);
            }

            const handleGeo = new THREE.TorusGeometry(0.2, 0.05, 8, 16);
            for (let i = 0; i < 2; i++) {
                group.add(
                    mesh(handleGeo, castIronMat, {
                        position: { x: (i === 0 ? 1 : -1) * (rimRadius + 0.1), y: rimHeight - 0.2, z: 0 },
                        rotation: { y: Math.PI / 2 },
                    })
                );
            }

            const liquidRadius = rimRadius * 0.95;
            liquid = mesh(
                new THREE.CylinderGeometry(liquidRadius, liquidRadius, 0.05, 32),
                liquidMat,
                { position: { y: liquidHeight }, receiveShadow: true }
            );
            group.add(liquid);

            glowLight = new THREE.PointLight(0x22ff22, 1.5, 6);
            glowLight.position.y = liquidHeight + 0.5;
            group.add(glowLight);
        },
        update: (deltaTime, time) => {
            const t = time + timeOffset;
            glowLight.intensity = 1.0 + Math.sin(t * 5) * 0.2 + Math.cos(t * 3.1) * 0.1;

            liquid.position.y = baseLiquidY + Math.sin(t * 2) * 0.02;
            if (bubbleTime > 0) {
                bubbleTime -= deltaTime;
                const surge = Math.sin((1 - bubbleTime / 0.35) * Math.PI) * 0.06;
                liquid.position.y += surge;
                liquid.scale.setScalar(1 + surge * 0.4);
            } else {
                liquid.scale.setScalar(1);
            }
        },
    });

    const interact = () => {
        result.group.getWorldPosition(_impactPos);
        playPropImpact({
            surface: 'bubble',
            volume: 0.55,
            position: { x: _impactPos.x, y: _impactPos.y + rimHeight * 0.5, z: _impactPos.z },
        });
        bubbleTime = 0.35;
    };

    return { ...result, interact };
}
