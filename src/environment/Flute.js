import * as THREE from 'three';
import { playFluteMelody } from '../audio/DiceCollisionAudio.js';
import { registerInteractable } from '../interactables/InteractableRegistry.js';
import { tween } from '../interactables/tween.js';
import { createProp, materials, mesh } from './propKit.js';

export function createFlute(
    scene,
    physicsWorld,
    position = { x: 0, y: -2.75, z: 0 },
    rotationY = 0
) {
    const length = 2.0;
    const radius = 0.08;
    const totalLength = length + 0.3;
    const woodMat = materials.wood();
    const darkWoodMat = materials.wood(0x3d2314);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    const result = createProp(scene, physicsWorld, {
        name: 'Flute',
        position,
        rotation: rotationY,
        footOffsetY: radius,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: totalLength / 2,
                rotation: { z: Math.PI / 2 },
            },
        ],
        build({ group }) {
            group.add(
                mesh(new THREE.CylinderGeometry(radius, radius, length, 16), woodMat, {
                    rotation: { z: Math.PI / 2 },
                })
            );

            group.add(
                mesh(new THREE.CylinderGeometry(radius, radius * 0.8, 0.3, 16), darkWoodMat, {
                    position: { x: -length / 2 - 0.15 },
                    rotation: { z: Math.PI / 2 },
                })
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(radius + 0.01, radius + 0.01, 0.1, 16),
                    darkWoodMat,
                    { position: { x: length / 2 }, rotation: { z: Math.PI / 2 } }
                )
            );

            const holeGeo = new THREE.CylinderGeometry(0.02, 0.02, radius * 2.1, 8);
            for (let i = 0; i < 6; i++) {
                group.add(
                    mesh(holeGeo, holeMat, {
                        position: { x: 0.1 + i * 0.2 },
                        rotation: { x: Math.PI / 2 },
                        castShadow: false,
                        receiveShadow: false,
                    })
                );
            }

            group.add(
                mesh(holeGeo, holeMat, {
                    position: { x: -0.7 },
                    rotation: { x: Math.PI / 2 },
                    castShadow: false,
                    receiveShadow: false,
                })
            );
        },
        dispose: () => {
            /* interactable handle is shared/overwritten across flutes */
        },
    });

    const { group } = result;
    const baseY = group.position.y;
    const baseRotX = group.rotation.x;
    let playCount = 0;
    let animating = false;

    const interact = () => {
        playCount++;
        playFluteMelody();
        if (animating) return;

        animating = true;
        tween({
            duration: 520,
            onUpdate: (e) => {
                const lift = Math.sin(e * Math.PI);
                group.position.y = baseY + lift * 0.12;
                group.rotation.x = baseRotX + lift * 0.12;
            },
            onComplete: () => {
                group.position.y = baseY;
                group.rotation.x = baseRotX;
                animating = false;
            },
        });
    };

    registerInteractable('flute', {
        trigger: interact,
        getState: () => ({ playCount }),
    });

    return { ...result, interact };
}
