import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createTavernMeal(
    scene,
    physicsWorld,
    position = { x: 10, y: -2.75, z: 10 },
    rotationY = Math.PI / 4
) {
    createMealTankard(scene, physicsWorld, position, rotationY);
    createFoodPlate(scene, physicsWorld, position, rotationY);
}

function createMealTankard(scene, physicsWorld, basePosition, baseRotation) {
    const radius = 0.35;
    const height = 0.8;

    createProp(scene, physicsWorld, {
        name: 'Tankard',
        position: { x: basePosition.x - 0.5, y: -2.35, z: basePosition.z - 0.5 },
        rotation: baseRotation + (Math.random() - 0.5) * 0.2,
        colliders: [
            {
                type: 'cylinder',
                radius,
                halfHeight: height / 2,
            },
        ],
        build({ group }) {
            const woodMat = new THREE.MeshStandardMaterial({
                color: 0x5c4033,
                roughness: 0.7,
            });

            const metalMat = new THREE.MeshStandardMaterial({
                color: 0xaaaaaa,
                metalness: 0.8,
                roughness: 0.4,
            });

            const foamMat = new THREE.MeshStandardMaterial({
                color: 0xffffee,
                roughness: 0.9,
                bumpScale: 0.02,
            });

            const bodyGeo = new THREE.CylinderGeometry(radius, radius, height, 16);
            const bodyMesh = new THREE.Mesh(bodyGeo, woodMat);
            bodyMesh.castShadow = true;
            bodyMesh.receiveShadow = true;
            group.add(bodyMesh);

            const bandGeo = new THREE.CylinderGeometry(radius + 0.01, radius + 0.01, 0.1, 16);

            const topBand = new THREE.Mesh(bandGeo, metalMat);
            topBand.position.y = height / 2 - 0.1;
            topBand.castShadow = true;
            topBand.receiveShadow = true;
            group.add(topBand);

            const botBand = new THREE.Mesh(bandGeo, metalMat);
            botBand.position.y = -height / 2 + 0.1;
            botBand.castShadow = true;
            botBand.receiveShadow = true;
            group.add(botBand);

            const handleGeo = new THREE.TorusGeometry(0.25, 0.05, 8, 16, Math.PI);
            const handleMesh = new THREE.Mesh(handleGeo, metalMat);
            handleMesh.rotation.z = -Math.PI / 2;
            handleMesh.position.set(radius, 0, 0);
            handleMesh.castShadow = true;
            handleMesh.receiveShadow = true;
            group.add(handleMesh);

            const foamGeo = new THREE.SphereGeometry(radius - 0.05, 16, 8);
            foamGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.4, 1));
            const foamMesh = new THREE.Mesh(foamGeo, foamMat);
            foamMesh.position.y = height / 2 + 0.05;
            group.add(foamMesh);
        },
    });
}

function createFoodPlate(scene, physicsWorld, basePosition, baseRotation) {
    const plateRadius = 0.8;
    const plateHeight = 0.1;

    createProp(scene, physicsWorld, {
        name: 'FoodPlate',
        position: { x: basePosition.x + 0.5, y: -2.7, z: basePosition.z + 0.5 },
        rotation: baseRotation + (Math.random() - 0.5) * 0.3,
        colliders: [
            {
                type: 'cylinder',
                radius: plateRadius,
                halfHeight: plateHeight / 2,
            },
        ],
        build({ group }) {
            const plateMat = new THREE.MeshStandardMaterial({
                color: 0xdddddd,
                roughness: 0.3,
            });

            const breadMat = new THREE.MeshStandardMaterial({
                color: 0xcd853f,
                roughness: 0.8,
            });

            const cheeseMat = new THREE.MeshStandardMaterial({
                color: 0xffd700,
                roughness: 0.5,
            });

            const plateGeo = new THREE.CylinderGeometry(
                plateRadius,
                plateRadius * 0.8,
                plateHeight,
                32
            );
            const plateMesh = new THREE.Mesh(plateGeo, plateMat);
            plateMesh.castShadow = true;
            plateMesh.receiveShadow = true;
            group.add(plateMesh);

            const breadGeo = new THREE.SphereGeometry(0.3, 16, 16);
            breadGeo.applyMatrix4(new THREE.Matrix4().makeScale(1.2, 0.7, 1));
            const breadMesh = new THREE.Mesh(breadGeo, breadMat);
            breadMesh.position.set(-0.2, plateHeight / 2 + 0.15, -0.2);
            breadMesh.castShadow = true;
            breadMesh.receiveShadow = true;
            group.add(breadMesh);

            const cheeseGeo = new THREE.CylinderGeometry(
                0.3,
                0.3,
                0.2,
                16,
                1,
                false,
                0,
                Math.PI / 3
            );
            const cheeseMesh = new THREE.Mesh(cheeseGeo, cheeseMat);
            cheeseMesh.position.set(0.3, plateHeight / 2 + 0.1, 0.3);
            cheeseMesh.castShadow = true;
            cheeseMesh.receiveShadow = true;
            group.add(cheeseMesh);
        },
    });
}
