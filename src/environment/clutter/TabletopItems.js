import * as THREE from 'three';
import { createStaticCollider } from '../../core/StaticColliderBridge.js';
import { TABLETOP_Y_OFFSET } from '../../core/SceneMetrics.js';
import { getInstancedMetalMaterial } from '../../core/MaterialPalette.js';
import { resolvePlacement } from './ClutterPlacement.js';

const tabletopY = (y) => y + TABLETOP_Y_OFFSET;
const randomUnit = (options) => (options?.rng ?? Math.random)();

export function createCoins(scene, physicsWorld, options = {}) {
    const radius = 0.3;
    const thickness = 0.05;
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 32);

    // Per-instance colours (gold/silver/copper) share one palette metallic material.
    const coinColors = [
        new THREE.Color(0xffd700),
        new THREE.Color(0xc0c0c0),
        new THREE.Color(0xb87333),
    ];
    const instanceMaterial = getInstancedMetalMaterial();

    const count = 15;
    const placement = resolvePlacement(options, { x: -4, z: 3 });
    const centerX = placement.x;
    const centerZ = placement.z;
    const baseY = tabletopY(-2.75);

    const coins = new THREE.InstancedMesh(geometry, instanceMaterial, count);
    coins.castShadow = true;
    coins.receiveShadow = true;
    coins.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    coins.userData.physicsBodies = [];

    for (let i = 0; i < count; i++) {
        coins.setColorAt(i, coinColors[Math.floor(randomUnit(options) * coinColors.length)]);

        const angle = randomUnit(options) * Math.PI * 2;
        const dist = randomUnit(options) * 1.5;
        const x = centerX + Math.cos(angle) * dist;
        const z = centerZ + Math.sin(angle) * dist;

        let y = baseY + thickness / 2;
        if (i > 5) y += thickness;
        if (i > 10) y += thickness;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, randomUnit(options) * Math.PI * 2, 0);

        if (randomUnit(options) > 0.8) {
            dummy.rotation.x = (randomUnit(options) - 0.5) * 0.5;
            dummy.rotation.z = (randomUnit(options) - 0.5) * 0.5;
            dummy.position.y += 0.05;
        }

        dummy.updateMatrix();
        coins.setMatrixAt(i, dummy.matrix);

        const result = createStaticCollider(physicsWorld, dummy, {
            type: 'cylinder',
            radius,
            halfHeight: thickness / 2,
        });
        if (result?.body) coins.userData.physicsBodies.push(result.body);
    }

    coins.instanceMatrix.needsUpdate = true;
    if (coins.instanceColor) coins.instanceColor.needsUpdate = true;

    scene.add(coins);
    options.track?.(coins);
}
