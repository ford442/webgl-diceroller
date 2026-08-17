import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createPencil(
    scene,
    physicsWorld,
    position = { x: -4, y: -2.75, z: -6 },
    rotationY = -Math.PI / 4
) {
    const pencilRadius = 0.1;
    const bodyLength = 3;
    const tipLength = 0.5;
    const ferruleLength = 0.3;
    const eraserLength = 0.4;
    const totalLength = tipLength + bodyLength + ferruleLength + eraserLength;

    return createProp(scene, physicsWorld, {
        name: 'Pencil',
        position,
        rotation: rotationY,
        footOffsetY: pencilRadius,
        colliders: [
            {
                type: 'cylinder',
                radius: pencilRadius,
                halfHeight: totalLength / 2,
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            const yellowPaintMat = new THREE.MeshStandardMaterial({
                color: 0xf4c542,
                roughness: 0.4,
                metalness: 0.1,
            });
            const woodMat = materials.wood(0xdeb887);
            const graphiteMat = new THREE.MeshStandardMaterial({
                color: 0x333333,
                roughness: 0.3,
                metalness: 0.5,
            });
            const metalMat = materials.steel();
            const eraserMat = new THREE.MeshStandardMaterial({
                color: 0xffb6c1,
                roughness: 0.9,
                metalness: 0.0,
            });

            group.add(
                mesh(new THREE.CylinderGeometry(pencilRadius, pencilRadius, eraserLength, 16), eraserMat, {
                    position: { y: eraserLength / 2 - totalLength / 2 },
                })
            );
            group.add(
                mesh(
                    new THREE.CylinderGeometry(
                        pencilRadius + 0.01,
                        pencilRadius + 0.01,
                        ferruleLength,
                        16
                    ),
                    metalMat,
                    { position: { y: eraserLength + ferruleLength / 2 - totalLength / 2 } }
                )
            );
            group.add(
                mesh(new THREE.CylinderGeometry(pencilRadius, pencilRadius, bodyLength, 6), yellowPaintMat, {
                    position: { y: eraserLength + ferruleLength + bodyLength / 2 - totalLength / 2 },
                })
            );
            group.add(
                mesh(new THREE.ConeGeometry(pencilRadius, tipLength, 16), woodMat, {
                    position: {
                        y: eraserLength + ferruleLength + bodyLength + tipLength / 2 - totalLength / 2,
                    },
                })
            );

            const pointLength = 0.15;
            const pointRadius = pencilRadius * (pointLength / tipLength);
            group.add(
                mesh(new THREE.ConeGeometry(pointRadius, pointLength, 16), graphiteMat, {
                    position: {
                        y:
                            eraserLength +
                            ferruleLength +
                            bodyLength +
                            tipLength -
                            pointLength / 2 -
                            totalLength / 2,
                    },
                })
            );

            group.rotation.set(Math.PI / 2, rotationY, 0, 'YXZ');
        },
    });
}
