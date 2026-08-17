import * as THREE from 'three';
import { createProp, mesh, STATIC_MATERIAL } from './propKit.js';

export function createBattleAxe(
    scene,
    physicsWorld,
    position = { x: 15, y: -6, z: 15 },
    rotationY = Math.PI / 4
) {
    const handleLen = 8.0;
    const handleRad = 0.15;
    const bladeWidth = 2.0;
    const bladeHeight = 1.5;
    const bladeThick = 0.2;

    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.9,
        metalness: 0.1,
    });

    const steelMaterial = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        roughness: 0.3,
        metalness: 0.9,
    });

    const legPos = new THREE.Vector3(9.25, -3, 9.25);
    const basePos = new THREE.Vector3(position.x, -10, position.z);
    const direction = new THREE.Vector3().subVectors(legPos, basePos).normalize();
    const midPoint = new THREE.Vector3()
        .copy(basePos)
        .add(direction.clone().multiplyScalar(handleLen / 2));

    const shape = new THREE.Shape();
    shape.moveTo(0, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.quadraticCurveTo(
        bladeWidth / 2,
        -bladeHeight / 2,
        bladeWidth / 2 + 0.5,
        -bladeHeight / 2 - 0.5
    );
    shape.quadraticCurveTo(
        bladeWidth / 2 - 0.2,
        0,
        bladeWidth / 2 + 0.5,
        bladeHeight / 2 + 0.5
    );
    shape.quadraticCurveTo(bladeWidth / 2, bladeHeight / 2, 0.5, 0.5);
    shape.lineTo(-0.5, 0.5);
    shape.quadraticCurveTo(
        -bladeWidth / 2,
        bladeHeight / 2,
        -bladeWidth / 2 - 0.5,
        bladeHeight / 2 + 0.5
    );
    shape.quadraticCurveTo(
        -bladeWidth / 2 + 0.2,
        0,
        -bladeWidth / 2 - 0.5,
        -bladeHeight / 2 - 0.5
    );
    shape.quadraticCurveTo(-bladeWidth / 2, -bladeHeight / 2, -0.5, -0.5);
    shape.lineTo(0, -0.5);

    const headGeo = new THREE.ExtrudeGeometry(shape, {
        steps: 1,
        depth: bladeThick,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 2,
    });
    headGeo.center();

    return createProp(scene, physicsWorld, {
        name: 'BattleAxe',
        position: { x: midPoint.x, y: midPoint.y, z: midPoint.z },
        colliders: [
            {
                type: 'cylinder',
                radius: handleRad,
                halfHeight: handleLen / 2,
                materialTag: STATIC_MATERIAL.WOOD,
            },
        ],
        build({ group }) {
            group.lookAt(legPos);
            group.rotateX(Math.PI / 2);
            if (rotationY !== 0) {
                group.rotateY(rotationY);
            }

            group.add(mesh(new THREE.CylinderGeometry(handleRad, handleRad, handleLen, 16), woodMaterial));

            group.add(
                mesh(headGeo, steelMaterial, { position: { y: handleLen / 2 - 1.0 } })
            );
        },
    });
}
