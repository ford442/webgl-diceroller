import * as THREE from 'three';
import { createProp, STATIC_MATERIAL } from './propKit.js';

export function createMeltingCandle(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotationY = 0
) {
    let lightRef = null;
    let initialIntensity = 2.0;

    return createProp(scene, physicsWorld, {
        name: 'MeltingCandle',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: 0.4,
                halfHeight: 0.6,
                offset: { y: 0.6 },
                materialTag: STATIC_MATERIAL.WOOD,
            }
        ],
        dispose() {
            if (lightRef) {
                lightRef.dispose();
            }
        },
        build({ group }) {
            // Candle Body (Wax)
            const radius = 0.4;
            const height = 1.2;
            const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
            const material = new THREE.MeshStandardMaterial({
                color: 0xeeeedd,
                roughness: 0.7,
                metalness: 0.0,
                emissive: 0xaa8844,
                emissiveIntensity: 0.1,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = height / 2;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);

            // Wick
            const wickGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.2);
            const wickMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
            const wick = new THREE.Mesh(wickGeo, wickMat);
            wick.position.y = height + 0.1;
            group.add(wick);

            // Light (Flame)
            const light = new THREE.PointLight(0xffaa44, initialIntensity, 15);
            light.position.y = height + 0.3;
            light.castShadow = false; // Do not cast shadows per user request
            group.add(light);
            lightRef = light;

            // Flame Mesh (Visual for the light)
            const flameGeo = new THREE.SphereGeometry(0.1, 8, 8);
            const flameMat = new THREE.MeshBasicMaterial({ color: 0xffdd88 });
            const flame = new THREE.Mesh(flameGeo, flameMat);
            flame.position.copy(light.position);
            group.add(flame);
        },
        update(deltaTime, time) {
            if (lightRef) {
                const noise = Math.sin(time * 15) * Math.sin(time * 22) * Math.sin(time * 7);
                lightRef.intensity = initialIntensity + noise * 0.5;
                lightRef.position.x = Math.sin(time * 10) * 0.02;
                lightRef.position.z = Math.cos(time * 12) * 0.02;
            }
        }
    });
}
