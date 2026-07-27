import * as THREE from 'three';
import { playPropImpact } from '../audio/DiceCollisionAudio.js';

export function createBell(
    scene,
    physicsWorld,
    position = { x: -10, y: -2.75, z: 10 },
    rotationY = 0
) {
    const group = new THREE.Group();
    group.name = 'Bell';
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    const brassMaterial = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        roughness: 0.3,
        metalness: 0.8,
    });

    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x5c4033,
        roughness: 0.8,
        metalness: 0.1,
    });

    const points = [];
    points.push(new THREE.Vector2(0, 0));
    points.push(new THREE.Vector2(1.2, 0));
    points.push(new THREE.Vector2(1.1, 0.5));
    points.push(new THREE.Vector2(0.8, 1.0));
    points.push(new THREE.Vector2(0.5, 1.5));
    points.push(new THREE.Vector2(0.4, 1.8));
    points.push(new THREE.Vector2(0.0, 1.8));

    const bellGeometry = new THREE.LatheGeometry(points, 32);
    const bellBody = new THREE.Mesh(bellGeometry, brassMaterial);
    bellBody.castShadow = true;
    bellBody.receiveShadow = true;
    group.add(bellBody);

    const handleGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 16);
    const handle = new THREE.Mesh(handleGeometry, woodMaterial);
    handle.position.set(0, 1.8 + 0.75, 0);
    handle.castShadow = true;
    handle.receiveShadow = true;
    group.add(handle);

    const clapperGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const clapper = new THREE.Mesh(clapperGeometry, brassMaterial);
    clapper.position.set(0, 0.2, 0);
    clapper.castShadow = true;
    group.add(clapper);

    scene.add(group);

    const _impactPos = new THREE.Vector3();
    let swingTime = 0;
    let swingAmp = 0;

    const interact = () => {
        group.getWorldPosition(_impactPos);
        playPropImpact({
            surface: 'bell',
            volume: 0.7,
            position: { x: _impactPos.x, y: _impactPos.y, z: _impactPos.z },
        });
        swingTime = 0.45;
        swingAmp = 0.35;
    };

    const update = (deltaTime) => {
        if (swingTime <= 0) return;
        swingTime -= deltaTime;
        const phase = (1 - swingTime / 0.45) * Math.PI * 6;
        const damp = Math.max(0, swingTime / 0.45);
        clapper.position.x = Math.sin(phase) * swingAmp * damp;
    };

    return { group, interact, update };
}
