import * as THREE from 'three';
import { createStaticCollider } from '../../core/StaticColliderBridge.js';
import { TABLETOP_Y_OFFSET } from '../../core/SceneMetrics.js';
import { getInstancedMetalMaterial } from '../../core/MaterialPalette.js';
import { resolvePlacement } from './ClutterPlacement.js';
import { propRng } from '../propRng.js';

const tabletopY = (y) => y + TABLETOP_Y_OFFSET;

export function createCoins(scene, physicsWorld, options = {}) {
    // The coin pile's own stream: the shared placement stream in `options.rng`
    // only places props, so a change here never shifts another prop's slot.
    const rng = propRng('Coins');
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

    for (let i = 0; i < count; i++) {
        coins.setColorAt(i, coinColors[Math.floor(rng() * coinColors.length)]);

        const angle = rng() * Math.PI * 2;
        const dist = rng() * 1.5;
        const x = centerX + Math.cos(angle) * dist;
        const z = centerZ + Math.sin(angle) * dist;

        let y = baseY + thickness / 2;
        if (i > 5) y += thickness;
        if (i > 10) y += thickness;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);

        if (rng() > 0.8) {
            dummy.rotation.x = (rng() - 0.5) * 0.5;
            dummy.rotation.z = (rng() - 0.5) * 0.5;
            dummy.position.y += 0.05;
        }

        dummy.updateMatrix();
        coins.setMatrixAt(i, dummy.matrix);

        createStaticCollider(physicsWorld, dummy, {
            type: 'cylinder',
            radius,
            halfHeight: thickness / 2,
        });
    }

    coins.instanceMatrix.needsUpdate = true;
    if (coins.instanceColor) coins.instanceColor.needsUpdate = true;

    scene.add(coins);
    options.track?.(coins);
}
