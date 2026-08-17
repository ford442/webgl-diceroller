import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createMerchantScale(
    scene,
    physicsWorld,
    position = { x: -14, y: -2.75, z: 2 },
    rotationY = -Math.PI / 4
) {
    const baseRadius = 1.0;
    const baseHeight = 0.2;
    const colHeight = 3.5;
    const colRadius = 0.15;
    const beamLength = 4.0;
    const chainLength = 2.0;
    const panRadius = 0.8;

    let beamGroup;
    let leftPan;
    let rightPan;

    const result = createProp(scene, physicsWorld, {
        name: 'MerchantScale',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: baseRadius,
                halfHeight: baseHeight / 2,
                offset: { y: baseHeight / 2 },
                materialTag: STATIC_MATERIAL.WOOD,
            },
            {
                type: 'cylinder',
                radius: colRadius,
                halfHeight: colHeight / 2,
                offset: { y: baseHeight + colHeight / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const brassMat = materials.brass();
            const woodMat = materials.wood();

            group.add(
                mesh(
                    new THREE.CylinderGeometry(baseRadius, baseRadius + 0.1, baseHeight, 16),
                    woodMat,
                    { position: { y: baseHeight / 2 } }
                )
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(colRadius, colRadius + 0.05, colHeight, 16),
                    brassMat,
                    { position: { y: baseHeight + colHeight / 2 } }
                )
            );

            beamGroup = new THREE.Group();
            beamGroup.position.y = baseHeight + colHeight;
            group.add(beamGroup);

            beamGroup.add(mesh(new THREE.BoxGeometry(beamLength, 0.2, 0.1), brassMat));
            beamGroup.add(
                mesh(new THREE.ConeGeometry(0.1, 0.3, 16), brassMat, { position: { y: 0.2 } })
            );

            function createPanAssembly(xOffset) {
                const assembly = new THREE.Group();
                assembly.position.x = xOffset;
                assembly.add(
                    mesh(new THREE.CylinderGeometry(0.02, 0.02, chainLength, 8), brassMat, {
                        position: { y: -chainLength / 2 },
                    })
                );
                const pan = mesh(
                    new THREE.SphereGeometry(panRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
                    brassMat,
                    { rotation: { z: Math.PI }, position: { y: -chainLength } }
                );
                assembly.add(pan);
                return assembly;
            }

            leftPan = createPanAssembly(-beamLength / 2 + 0.1);
            rightPan = createPanAssembly(beamLength / 2 - 0.1);
            beamGroup.add(leftPan);
            beamGroup.add(rightPan);
        },
    });

    const update = (time) => {
        const angle = Math.sin(time * 1.5) * 0.05;
        beamGroup.rotation.z = angle;
        leftPan.rotation.z = -angle;
        rightPan.rotation.z = -angle;
    };

    return { ...result, update };
}
