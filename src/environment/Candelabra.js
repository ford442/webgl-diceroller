import * as THREE from 'three';
import { createFire } from './Fire.js';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createCandelabra(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotationY = 0
) {
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.2,
    });

    const waxMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5e0,
        roughness: 0.4,
        metalness: 0.0,
        emissive: 0x221a10,
        emissiveIntensity: 0.1,
    });

    const wickMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 1.0,
        emissive: 0x331100,
        emissiveIntensity: 0.3,
    });

    const flames = [];

    function addCandle(parent, offsetX, offsetY, offsetZ) {
        parent.add(
            mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.2, 16), brassMat, {
                position: { x: offsetX, y: offsetY, z: offsetZ },
            })
        );

        const candleHeight = 0.8 + Math.random() * 0.4;
        parent.add(
            mesh(new THREE.CylinderGeometry(0.15, 0.15, candleHeight, 16), waxMaterial, {
                position: { x: offsetX, y: offsetY + 0.1 + candleHeight / 2, z: offsetZ },
            })
        );

        const wickHeight = 0.1;
        parent.add(
            mesh(new THREE.CylinderGeometry(0.02, 0.02, wickHeight, 8), wickMat, {
                position: {
                    x: offsetX,
                    y: offsetY + 0.1 + candleHeight + wickHeight / 2,
                    z: offsetZ,
                },
            })
        );

        const fire = createFire({
            scale: 0.3,
            color: 0xffaa00,
            particleCount: 15,
            spread: 0.05,
        });
        fire.mesh.position.set(offsetX, offsetY + 0.1 + candleHeight + wickHeight, offsetZ);
        parent.add(fire.mesh);

        const flameLight = new THREE.PointLight(0xff6600, 0.5, 5);
        flameLight.position.copy(fire.mesh.position);
        parent.add(flameLight);

        flames.push({ fire, light: flameLight });
    }

    return createProp(scene, physicsWorld, {
        name: 'Candelabra',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: 1.2,
                halfHeight: 0.1,
                offset: { y: 0.1 },
                materialTag: STATIC_MATERIAL.METAL,
            },
            {
                type: 'cylinder',
                radius: 1.3,
                halfHeight: 1.2,
                offset: { y: 1.8 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            group.add(
                mesh(new THREE.CylinderGeometry(0.8, 1.2, 0.2, 16), brassMat, {
                    position: { y: 0.1 },
                })
            );

            group.add(
                mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.5, 16), brassMat, {
                    position: { y: 0.95 },
                })
            );

            group.add(
                mesh(new THREE.SphereGeometry(0.3, 16, 16), brassMat, { position: { y: 1.0 } })
            );

            addCandle(group, 0, 1.7, 0);

            const numArms = 4;
            const armRadius = 1.0;
            const armHeight = 1.4;

            for (let i = 0; i < numArms; i++) {
                const angle = (i / numArms) * Math.PI * 2;

                const curve = new THREE.CatmullRomCurve3([
                    new THREE.Vector3(Math.cos(angle) * 0.2, 1.0, Math.sin(angle) * 0.2),
                    new THREE.Vector3(
                        Math.cos(angle) * armRadius * 0.6,
                        0.8,
                        Math.sin(angle) * armRadius * 0.6
                    ),
                    new THREE.Vector3(
                        Math.cos(angle) * armRadius,
                        armHeight - 0.2,
                        Math.sin(angle) * armRadius
                    ),
                ]);

                group.add(mesh(new THREE.TubeGeometry(curve, 16, 0.08, 8, false), brassMat));

                addCandle(
                    group,
                    Math.cos(angle) * armRadius,
                    armHeight,
                    Math.sin(angle) * armRadius
                );
            }
        },
        update(deltaTime, time) {
            flames.forEach((f) => {
                f.fire.update(deltaTime);

                const breathing = Math.sin(time * 2.0) * 0.08;
                const flicker = (Math.random() - 0.5) * 0.12;
                f.light.intensity = 0.5 + breathing + flicker;

                const hueShift = Math.sin(time * 3.5) * 0.03;
                f.light.color.setHSL(0.08 + hueShift, 1.0, 0.52);
            });
        },
    });
}
