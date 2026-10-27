import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createWineBottle(
    scene,
    physicsWorld,
    position = { x: -4, y: -2.75, z: -8 },
    rotationY = 0
) {
    const radius = 0.15; // Realistic bottle width
    const totalHeight = 1.0;
    const bodyHeight = 0.6;
    const neckRadius = 0.05;
    const _neckHeight = 0.3;
    const shoulderHeight = 0.1;
    const segments = 16;

    const bottomY = -totalHeight / 2;

    const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x1f3c25, // Dark green
        metalness: 0.1,
        roughness: 0.2,
        transmission: 0.8,
        thickness: 0.1,
        envMapIntensity: 1.5,
        transparent: true,
        opacity: 0.9,
    });

    return createProp(scene, physicsWorld, {
        name: 'WineBottle',
        position,
        rotation: rotationY,
        footOffsetY: totalHeight / 2, // Center of cylinder
        colliders: [
            {
                type: 'cylinder', // Ammo.js btCylinderShape defaults to Y-up
                radius,
                halfHeight: totalHeight / 2,
                materialTag: STATIC_MATERIAL.DEFAULT,
            },
        ],
        build({ group }) {
            // Body (from bottomY to bottomY + bodyHeight)
            // Center is at bottomY + bodyHeight / 2
            const bodyGeo = new THREE.CylinderGeometry(radius, radius, bodyHeight, segments);
            bodyGeo.translate(0, bottomY + bodyHeight / 2, 0);
            group.add(mesh(bodyGeo, glassMaterial));

            // Shoulder (from bottomY + bodyHeight to bottomY + bodyHeight + shoulderHeight)
            const shoulderGeo = new THREE.CylinderGeometry(
                neckRadius,
                radius,
                shoulderHeight,
                segments
            );
            shoulderGeo.translate(0, bottomY + bodyHeight + shoulderHeight / 2, 0);
            group.add(mesh(shoulderGeo, glassMaterial));

            // Neck (from bottomY + bodyHeight + shoulderHeight to top)
            const finalNeckHeight = totalHeight - bodyHeight - shoulderHeight;
            const neckGeo = new THREE.CylinderGeometry(
                neckRadius,
                neckRadius,
                finalNeckHeight,
                segments
            );
            neckGeo.translate(0, bottomY + bodyHeight + shoulderHeight + finalNeckHeight / 2, 0);
            group.add(mesh(neckGeo, glassMaterial));
        },
    });
}
