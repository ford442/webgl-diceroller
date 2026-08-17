import * as THREE from 'three';
import { registerInteractiveObject } from '../interaction.js';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createLantern(
    scene,
    physicsWorld,
    position = { x: -8, y: -2.75, z: -12 },
    rotationY = 0
) {
    const baseHeight = 0.2;
    const bodyHeight = 0.8;
    const capHeight = 0.25;
    const ventHeight = 0.15;
    const totalHeight = baseHeight + bodyHeight + capHeight + ventHeight + 0.4;
    const halfHeight = totalHeight / 2;
    const bodyRadiusTop = 0.4;

    let light;
    let candleMat;
    let isOn = true;

    const result = createProp(scene, physicsWorld, {
        name: 'Lantern',
        position,
        rotation: rotationY,
        footOffsetY: halfHeight,
        colliders: [
            {
                type: 'cylinder',
                radius: bodyRadiusTop + 0.05,
                halfHeight,
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const metalMat = materials.wroughtIron();
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                metalness: 0,
                roughness: 0.1,
                transmission: 0.9,
                transparent: true,
                ior: 1.5,
                thickness: 0.05,
            });
            candleMat = new THREE.MeshStandardMaterial({
                color: 0xffffdd,
                roughness: 0.6,
            });
            candleMat.emissive.setHex(0x332200);

            const baseRadius = 0.4;
            group.add(
                mesh(
                    new THREE.CylinderGeometry(baseRadius, baseRadius + 0.1, baseHeight, 8),
                    metalMat,
                    { position: { y: baseHeight / 2 - halfHeight } }
                )
            );

            const bodyRadiusBot = 0.35;
            group.add(
                mesh(
                    new THREE.CylinderGeometry(bodyRadiusTop, bodyRadiusBot, bodyHeight, 8),
                    glassMat,
                    { position: { y: baseHeight + bodyHeight / 2 - halfHeight } }
                )
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(0.2, bodyRadiusTop + 0.05, capHeight, 8),
                    metalMat,
                    { position: { y: baseHeight + bodyHeight + capHeight / 2 - halfHeight } }
                )
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(0.1, 0.2, ventHeight, 8),
                    metalMat,
                    {
                        position: {
                            y: baseHeight + bodyHeight + capHeight + ventHeight / 2 - halfHeight,
                        },
                    }
                )
            );

            group.add(
                mesh(new THREE.TorusGeometry(0.25, 0.03, 8, 16), metalMat, {
                    position: {
                        y:
                            baseHeight +
                            bodyHeight +
                            capHeight +
                            ventHeight +
                            0.15 -
                            halfHeight,
                    },
                })
            );

            const barGeo = new THREE.CylinderGeometry(0.02, 0.02, bodyHeight, 4);
            for (let i = 0; i < 4; i++) {
                const angle = (Math.PI / 2) * i + Math.PI / 4;
                group.add(
                    mesh(barGeo, metalMat, {
                        position: {
                            x: Math.cos(angle) * (bodyRadiusTop + 0.02),
                            y: baseHeight + bodyHeight / 2 - halfHeight,
                            z: Math.sin(angle) * (bodyRadiusTop + 0.02),
                        },
                    })
                );
            }

            const candleRadius = 0.15;
            const candleHeight = 0.4;
            group.add(
                mesh(
                    new THREE.CylinderGeometry(candleRadius, candleRadius, candleHeight, 16),
                    candleMat,
                    { position: { y: baseHeight + candleHeight / 2 - halfHeight } }
                )
            );

            light = new THREE.PointLight(0xffa500, 1.5, 10);
            light.position.y = baseHeight + candleHeight + 0.1 - halfHeight;
            light.castShadow = true;
            light.shadow.bias = -0.001;
            group.add(light);
        },
    });

    const toggleLight = () => {
        isOn = !isOn;
        light.intensity = isOn ? 1.5 : 0;
        if (isOn) {
            candleMat.emissive.setHex(0x332200);
        } else {
            candleMat.emissive.setHex(0x000000);
        }
    };

    if (typeof registerInteractiveObject === 'function') {
        registerInteractiveObject(result.group, toggleLight);
    }

    const update = (time) => {
        if (!isOn) return;
        const flicker = Math.sin(time * 10) * 0.1 + Math.sin(time * 25) * 0.05;
        light.intensity = 1.5 + flicker;
        light.position.x = (Math.random() - 0.5) * 0.02;
        light.position.z = (Math.random() - 0.5) * 0.02;
    };

    return { ...result, update };
}
