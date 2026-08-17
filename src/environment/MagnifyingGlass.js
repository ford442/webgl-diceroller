import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createMagnifyingGlass(
    scene,
    physicsWorld,
    position = { x: 0, y: -2.75, z: 0 },
    rotationY = 0
) {
    const handleLength = 1.0;
    const handleRadius = 0.08;
    const connectorLength = 0.2;
    const connectorRadius = 0.05;
    const rimOuterRadius = 0.6;
    const rimTube = 0.04;
    const lensRadius = rimOuterRadius - rimTube;
    const lensThickness = 0.05;
    const totalLength = handleLength + connectorLength + rimOuterRadius * 2;
    const zOffset = -(totalLength / 2) + handleLength + connectorLength + rimOuterRadius;

    const result = createProp(scene, physicsWorld, {
        name: 'MagnifyingGlass',
        position,
        rotation: rotationY,
        footOffsetY: handleRadius,
        colliders: [
            {
                type: 'box',
                halfExtents: [rimOuterRadius, handleRadius, totalLength / 2],
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const brassMat = materials.brass();
            const woodMat = materials.wood();
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                metalness: 0,
                roughness: 0,
                transmission: 0.95,
                transparent: true,
                ior: 1.5,
                thickness: 0.1,
            });

            group.add(
                mesh(new THREE.CylinderGeometry(handleRadius, handleRadius, handleLength, 16), woodMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { z: -(handleLength / 2) - connectorLength - rimOuterRadius + zOffset },
                })
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(connectorRadius, connectorRadius, connectorLength, 16),
                    brassMat,
                    {
                        rotation: { x: Math.PI / 2 },
                        position: { z: -(connectorLength / 2) - rimOuterRadius + zOffset },
                    }
                )
            );

            group.add(
                mesh(new THREE.TorusGeometry(rimOuterRadius, rimTube, 16, 32), brassMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { z: zOffset },
                })
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(lensRadius, lensRadius, lensThickness, 32),
                    glassMat,
                    { position: { z: zOffset }, castShadow: false }
                )
            );
        },
    });

    return result.group;
}
