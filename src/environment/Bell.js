import * as THREE from 'three';
import { playPropImpact } from '../audio/DiceCollisionAudio.js';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createBell(
    scene,
    physicsWorld,
    position = { x: -10, y: -2.75, z: 10 },
    rotationY = 0
) {
    const groupRef = { current: null };
    const clapperRef = { current: null };
    const impactPos = new THREE.Vector3();
    let swingTime = 0;
    let swingAmp = 0;

    const interact = () => {
        const group = groupRef.current;
        if (!group) return;
        group.getWorldPosition(impactPos);
        playPropImpact({
            surface: 'bell',
            volume: 0.7,
            position: { x: impactPos.x, y: impactPos.y, z: impactPos.z },
        });
        swingTime = 0.45;
        swingAmp = 0.35;
    };

    const update = (deltaTime) => {
        const clapper = clapperRef.current;
        if (!clapper || swingTime <= 0) return;
        swingTime -= deltaTime;
        const phase = (1 - swingTime / 0.45) * Math.PI * 6;
        const damp = Math.max(0, swingTime / 0.45);
        clapper.position.x = Math.sin(phase) * swingAmp * damp;
    };

    const result = createProp(scene, physicsWorld, {
        name: 'Bell',
        position,
        rotation: rotationY,
        footOffsetY: 0.9,
        colliders: [
            {
                type: 'cylinder',
                radius: 1.1,
                halfHeight: 0.9,
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            groupRef.current = group;

            const points = [];
            points.push(new THREE.Vector2(0, 0));
            points.push(new THREE.Vector2(1.2, 0));
            points.push(new THREE.Vector2(1.1, 0.5));
            points.push(new THREE.Vector2(0.8, 1.0));
            points.push(new THREE.Vector2(0.5, 1.5));
            points.push(new THREE.Vector2(0.4, 1.8));
            points.push(new THREE.Vector2(0.0, 1.8));

            group.add(mesh(new THREE.LatheGeometry(points, 32), materials.brass()));

            group.add(
                mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.5, 16), materials.wood(0x5c4033), {
                    position: { y: 1.8 + 0.75 },
                })
            );

            const clapper = mesh(new THREE.SphereGeometry(0.2, 16, 16), materials.brass(), {
                position: { y: 0.2 },
            });
            clapperRef.current = clapper;
            group.add(clapper);
        },
        update,
        interact,
    });

    return { ...result, interact, update };
}
