import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createWaxSeal(
    scene,
    physicsWorld,
    position = { x: 10, y: -2.75, z: -8 },
    rotationY = 0
) {
    const baseHeight = 0.2;
    const baseRadius = 0.3;
    const totalHeight = 1.2;
    const visualShift = totalHeight / 2;

    createProp(scene, physicsWorld, {
        name: 'WaxSealStamp',
        position,
        rotation: rotationY,
        footOffsetY: visualShift,
        colliders: [
            {
                type: 'cylinder',
                radius: baseRadius,
                halfHeight: totalHeight / 2,
            },
        ],
        build({ group }) {
            const woodMat = new THREE.MeshStandardMaterial({
                color: 0x3e2723,
                roughness: 0.7,
                metalness: 0.1,
            });

            const brassMat = new THREE.MeshStandardMaterial({
                color: 0xb5a642,
                metalness: 0.9,
                roughness: 0.3,
            });

            const waxMat = new THREE.MeshStandardMaterial({
                color: 0x8b0000,
                roughness: 0.4,
                metalness: 0.1,
            });

            const points = [];
            points.push(new THREE.Vector2(0, 0));
            points.push(new THREE.Vector2(0.15, 0));
            points.push(new THREE.Vector2(0.2, 0.1));
            points.push(new THREE.Vector2(0.12, 0.3));
            points.push(new THREE.Vector2(0.1, 0.5));
            points.push(new THREE.Vector2(0.15, 0.8));
            points.push(new THREE.Vector2(0.25, 0.9));
            points.push(new THREE.Vector2(0.2, 1.0));
            points.push(new THREE.Vector2(0, 1.0));

            const handleGeo = new THREE.LatheGeometry(points, 16);
            const handleMesh = new THREE.Mesh(handleGeo, woodMat);
            handleMesh.castShadow = true;
            handleMesh.receiveShadow = true;
            handleMesh.position.y = 0.2 - visualShift;
            group.add(handleMesh);

            const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 16);
            const baseMesh = new THREE.Mesh(baseGeo, brassMat);
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            baseMesh.position.y = baseHeight / 2 - visualShift;
            group.add(baseMesh);

            const waxRadius = 0.4;
            const waxHeight = 0.05;
            const waxGeo = new THREE.CylinderGeometry(waxRadius, waxRadius, waxHeight, 16);

            const positions = waxGeo.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i);
                const z = positions.getZ(i);
                const y = positions.getY(i);

                if (Math.abs(x) > 0.01 || Math.abs(z) > 0.01) {
                    const offset = (Math.sin(x * 10) + Math.cos(z * 10)) * 0.05;
                    const len = Math.sqrt(x * x + z * z);
                    if (len > 0) {
                        positions.setX(i, x + (x / len) * offset);
                        positions.setZ(i, z + (z / len) * offset);
                    }
                    if (y > 0) {
                        positions.setY(i, y + Math.random() * 0.02);
                    }
                }
            }
            waxGeo.computeVertexNormals();

            const waxMesh = new THREE.Mesh(waxGeo, waxMat);
            waxMesh.castShadow = true;
            waxMesh.receiveShadow = true;
            waxMesh.position.set(0.6, waxHeight / 2 - visualShift, 0.2);
            group.add(waxMesh);

            const dripGeo = new THREE.SphereGeometry(0.04, 8, 8);
            const dripMesh = new THREE.Mesh(dripGeo, waxMat);
            dripMesh.position.set(baseRadius - 0.01, baseHeight / 2 - visualShift, 0);
            dripMesh.scale.y = 2.0;
            group.add(dripMesh);
        },
    });
}
