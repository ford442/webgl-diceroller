import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createCrossbow(
    scene,
    physicsWorld,
    position = { x: 5, y: -2.75, z: 8 },
    rotationY = Math.PI / 3
) {
    return createProp(scene, physicsWorld, {
        name: 'Crossbow',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [0.4, 0.3, 3.0],
                offset: { y: 0.3 },
            },
            {
                type: 'box',
                halfExtents: [3.2, 0.1, 0.2],
                offset: { y: 0.3, z: 2.0 },
            },
        ],
        build({ group }) {
            const woodMaterial = new THREE.MeshStandardMaterial({
                color: 0x3e2723,
                roughness: 0.8,
                metalness: 0.05,
            });

            const ironMaterial = new THREE.MeshStandardMaterial({
                color: 0x4a4a4a,
                metalness: 0.8,
                roughness: 0.4,
            });

            const stringMaterial = new THREE.MeshStandardMaterial({
                color: 0xdddddd,
                roughness: 0.9,
                metalness: 0.0,
            });

            const stockGeo = new THREE.BoxGeometry(0.8, 0.6, 6.0);
            const stock = new THREE.Mesh(stockGeo, woodMaterial);
            stock.position.set(0, 0.3, 0);
            stock.castShadow = true;
            stock.receiveShadow = true;
            group.add(stock);

            const armGeo = new THREE.BoxGeometry(3.5, 0.2, 0.4);

            const leftArm = new THREE.Mesh(armGeo, woodMaterial);
            leftArm.position.set(-1.6, 0.3, 2.0);
            leftArm.rotation.y = -Math.PI / 8;
            leftArm.castShadow = true;
            leftArm.receiveShadow = true;
            group.add(leftArm);

            const rightArm = new THREE.Mesh(armGeo, woodMaterial);
            rightArm.position.set(1.6, 0.3, 2.0);
            rightArm.rotation.y = Math.PI / 8;
            rightArm.castShadow = true;
            rightArm.receiveShadow = true;
            group.add(rightArm);

            const stirrupGeo = new THREE.TorusGeometry(0.5, 0.08, 8, 16, Math.PI);
            const stirrup = new THREE.Mesh(stirrupGeo, ironMaterial);
            stirrup.position.set(0, 0.3, 3.0);
            stirrup.rotation.x = Math.PI / 2;
            stirrup.castShadow = true;
            stirrup.receiveShadow = true;
            group.add(stirrup);

            const nutGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 16);
            const nut = new THREE.Mesh(nutGeo, ironMaterial);
            nut.position.set(0, 0.6, -1.0);
            nut.rotation.z = Math.PI / 2;
            nut.castShadow = true;
            nut.receiveShadow = true;
            group.add(nut);

            const triggerGeo = new THREE.BoxGeometry(0.1, 0.8, 0.3);
            const trigger = new THREE.Mesh(triggerGeo, ironMaterial);
            trigger.position.set(0, -0.2, -1.2);
            trigger.rotation.x = Math.PI / 6;
            trigger.castShadow = true;
            trigger.receiveShadow = true;
            group.add(trigger);

            const stringGeo = new THREE.CylinderGeometry(0.02, 0.02, 3.4, 8);

            const leftString = new THREE.Mesh(stringGeo, stringMaterial);
            leftString.position.set(-1.5, 0.4, 0.3);
            leftString.rotation.x = Math.PI / 2;
            leftString.rotation.z = -0.55;
            leftString.castShadow = true;
            group.add(leftString);

            const rightString = new THREE.Mesh(stringGeo, stringMaterial);
            rightString.position.set(1.5, 0.4, 0.3);
            rightString.rotation.x = Math.PI / 2;
            rightString.rotation.z = 0.55;
            rightString.castShadow = true;
            group.add(rightString);
        },
    });
}
