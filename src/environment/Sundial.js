import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createSundial(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 6 },
    rotationY = -Math.PI / 6
) {
    const baseRadius = 1.2;
    const baseHeight = 0.2;

    return createProp(scene, physicsWorld, {
        name: 'Sundial',
        position,
        rotation: rotationY,
        footOffsetY: baseHeight / 2,
        colliders: [
            {
                type: 'cylinder',
                radius: baseRadius,
                halfHeight: baseHeight / 2,
            },
        ],
        build({ group }) {
            const brassMat = new THREE.MeshStandardMaterial({
                color: 0xb5a642,
                roughness: 0.4,
                metalness: 0.8,
                bumpScale: 0.02,
            });

            const darkBrassMat = new THREE.MeshStandardMaterial({
                color: 0x8a7b32,
                roughness: 0.5,
                metalness: 0.7,
            });

            const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 32);
            const baseMesh = new THREE.Mesh(baseGeo, brassMat);
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            group.add(baseMesh);

            const ringGeo = new THREE.TorusGeometry(baseRadius - 0.2, 0.05, 16, 32);
            const ringMesh = new THREE.Mesh(ringGeo, darkBrassMat);
            ringMesh.rotation.x = -Math.PI / 2;
            ringMesh.position.set(0, baseHeight / 2 + 0.02, 0);
            ringMesh.castShadow = true;
            ringMesh.receiveShadow = true;
            group.add(ringMesh);

            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.lineTo(baseRadius - 0.3, 0);
            shape.lineTo(0, baseRadius - 0.3);
            shape.lineTo(0, 0);

            const extrudeSettings = { depth: 0.05, bevelEnabled: false };
            const gnomonGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            gnomonGeo.computeBoundingBox();
            const centerOffset = -0.5 * (gnomonGeo.boundingBox.max.z - gnomonGeo.boundingBox.min.z);
            gnomonGeo.translate(0, 0, centerOffset);

            const gnomonMesh = new THREE.Mesh(gnomonGeo, darkBrassMat);
            gnomonMesh.position.set(-0.2, baseHeight / 2, 0);
            gnomonMesh.castShadow = true;
            gnomonMesh.receiveShadow = true;
            group.add(gnomonMesh);
        },
    });
}
