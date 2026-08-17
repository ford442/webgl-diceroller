import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createPotionSet(
    scene,
    physicsWorld,
    position = { x: 12, y: -2.75, z: -6 },
    rotationY = -Math.PI / 6
) {
    const stepWidth = 4;
    const stepDepth = 1.5;
    const stepHeight = 0.5;

    return createProp(scene, physicsWorld, {
        name: 'PotionSet',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [stepWidth / 2, stepHeight / 2, stepDepth],
                offset: { y: stepHeight / 2 },
            },
            {
                type: 'box',
                halfExtents: [stepWidth / 2, stepHeight / 2, stepDepth / 2],
                offset: { y: stepHeight + stepHeight / 2, z: -stepDepth / 2 },
            },
            {
                type: 'cylinder',
                radius: 0.4,
                halfHeight: 0.4,
                offset: { x: -1.0, y: 1.4, z: -0.5 },
            },
            {
                type: 'box',
                halfExtents: [0.3, 0.5, 0.3],
                offset: { x: 1.0, y: 1.5, z: -0.5 },
            },
            {
                type: 'cylinder',
                radius: 0.3,
                halfHeight: 0.5,
                offset: { x: 0, y: 1.0, z: 0.8 },
            },
        ],
        build({ group }) {
            const woodMat = new THREE.MeshStandardMaterial({
                color: 0x8b4513,
                roughness: 0.8,
                bumpScale: 0.1,
            });

            const botStepGeo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth * 2);
            const botStep = new THREE.Mesh(botStepGeo, woodMat);
            botStep.position.y = stepHeight / 2;
            botStep.castShadow = true;
            botStep.receiveShadow = true;
            group.add(botStep);

            const topStepGeo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
            const topStep = new THREE.Mesh(topStepGeo, woodMat);
            topStep.position.set(0, stepHeight + stepHeight / 2, -stepDepth / 2);
            topStep.castShadow = true;
            topStep.receiveShadow = true;
            group.add(topStep);

            group.add(createRoundPotion(0xff0000, -1.0, stepHeight * 2, -0.5));
            group.add(createSquarePotion(0x0000ff, 1.0, stepHeight * 2, -0.5));
            group.add(createConicalPotion(0x00ff00, 0, stepHeight, 0.8));
        },
    });
}

function createRoundPotion(color, x, y, z) {
    const group = new THREE.Group();
    const points = [];
    for (let i = 0; i <= 10; i++) {
        const angle = (Math.PI / 2) * (i / 10);
        points.push(new THREE.Vector2(Math.sin(angle) * 0.4, -Math.cos(angle) * 0.4 + 0.4));
    }
    points.push(new THREE.Vector2(0.15, 0.8), new THREE.Vector2(0.2, 0.85));

    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.1,
        transmission: 0.9,
        thickness: 0.1,
        transparent: true,
    });
    const flask = new THREE.Mesh(new THREE.LatheGeometry(points, 16), mat);
    flask.castShadow = true;
    flask.receiveShadow = true;
    group.add(flask);

    const liquidMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.6,
        transparent: true,
    });
    const liquid = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), liquidMat);
    liquid.position.y = 0.4;
    group.add(liquid);

    const cork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.1, 0.2, 16),
        new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 })
    );
    cork.position.y = 0.9;
    group.add(cork);

    group.position.set(x, y, z);
    return group;
}

function createSquarePotion(color, x, y, z) {
    const group = new THREE.Group();
    const width = 0.6;
    const height = 1.0;
    const depth = 0.6;
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.1,
        transmission: 0.9,
        thickness: 0.1,
        transparent: true,
    });
    const bottle = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    bottle.position.y = height / 2;
    bottle.castShadow = true;
    bottle.receiveShadow = true;
    group.add(bottle);

    const liquidMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        transmission: 0.6,
        transparent: true,
    });
    const liquid = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.1, height * 0.7, depth - 0.1),
        liquidMat
    );
    liquid.position.y = (height * 0.7) / 2 + 0.05;
    group.add(liquid);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16), mat);
    neck.position.y = height + 0.15;
    group.add(neck);

    const cork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.12, 0.2, 16),
        new THREE.MeshStandardMaterial({ color: 0x8b4513 })
    );
    cork.position.y = height + 0.35;
    group.add(cork);

    group.position.set(x, y, z);
    return group;
}

function createConicalPotion(color, x, y, z) {
    const group = new THREE.Group();
    const points = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.5, 0),
        new THREE.Vector2(0.15, 0.8),
        new THREE.Vector2(0.2, 0.9),
    ];
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 0.9,
        thickness: 0.1,
        roughness: 0.1,
        transparent: true,
    });
    const flask = new THREE.Mesh(new THREE.LatheGeometry(points, 16), mat);
    flask.castShadow = true;
    flask.receiveShadow = true;
    group.add(flask);

    const liquidMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        transmission: 0.6,
        transparent: true,
    });
    const liquid = new THREE.Mesh(
        new THREE.LatheGeometry(
            [new THREE.Vector2(0, 0), new THREE.Vector2(0.45, 0), new THREE.Vector2(0.2, 0.6)],
            16
        ),
        liquidMat
    );
    liquid.position.y = 0.05;
    group.add(liquid);

    const cork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.1, 0.2, 16),
        new THREE.MeshStandardMaterial({ color: 0x8b4513 })
    );
    cork.position.y = 0.9;
    group.add(cork);

    group.position.set(x, y, z);
    return group;
}
