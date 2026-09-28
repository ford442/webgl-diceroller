import * as THREE from 'three';
import { createProp, materials } from './propKit.js';

export function createPotionBottle(
    scene,
    physicsWorld,
    position = { x: 6, y: -2.15, z: -2 },
    rotationY = 0,
    { scale = 1 } = {}
) {
    return createProp(scene, physicsWorld, {
        name: 'PotionBottle',
        position,
        rotation: rotationY,
        scale,
        colliders: [
            {
                type: 'cylinder',
                radius: 0.6,
                halfHeight: 0.8,
                dynamic: true,
                mass: 0.2,
            },
        ],
        build({ group }) {
            const points = [];
            for (let i = 0; i <= 10; i++) {
                const angle = (Math.PI / 2) * (i / 10);
                points.push(new THREE.Vector2(Math.sin(angle) * 0.6, -Math.cos(angle) * 0.6));
            }
            points.push(new THREE.Vector2(0.2, 0.2));
            points.push(new THREE.Vector2(0.2, 0.8));
            points.push(new THREE.Vector2(0.25, 0.8));
            points.push(new THREE.Vector2(0.25, 0.9));
            points.push(new THREE.Vector2(0.15, 0.9));

            const bottleGeo = new THREE.LatheGeometry(points, 16);
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xffffff,
                metalness: 0,
                roughness: 0.1,
                transmission: 0.9,
                thickness: 0.5,
                ior: 1.5,
                transparent: true,
                opacity: 1.0,
                side: THREE.DoubleSide,
            });

            const bottleMesh = new THREE.Mesh(bottleGeo, glassMat);
            bottleMesh.castShadow = true;
            bottleMesh.receiveShadow = true;
            group.add(bottleMesh);

            const liquidPoints = [];
            for (let i = 0; i <= 8; i++) {
                const angle = (Math.PI / 2) * (i / 10);
                liquidPoints.push(
                    new THREE.Vector2(Math.sin(angle) * 0.55, -Math.cos(angle) * 0.55)
                );
            }
            liquidPoints.push(new THREE.Vector2(0, -Math.cos((Math.PI / 2) * 0.8) * 0.55));

            const liquidGeo = new THREE.LatheGeometry(liquidPoints, 16);
            const liquidMat = new THREE.MeshPhysicalMaterial({
                color: 0xff0000,
                emissive: 0x330000,
                metalness: 0.1,
                roughness: 0.2,
                transmission: 0.6,
                transparent: true,
            });
            group.add(new THREE.Mesh(liquidGeo, liquidMat));

            const corkGeo = new THREE.CylinderGeometry(0.18, 0.15, 0.3, 16);
            const corkMesh = new THREE.Mesh(corkGeo, materials.wood(0x8b4513));
            corkMesh.position.y = 0.85;
            bottleMesh.add(corkMesh);
        },
    });
}
