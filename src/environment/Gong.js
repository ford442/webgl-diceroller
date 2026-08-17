import * as THREE from 'three';
import { playPropImpact } from '../audio/DiceCollisionAudio.js';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createGong(
    scene,
    physicsWorld,
    position = { x: -15, y: -7.5, z: -15 },
    rotationY = Math.PI / 4
) {
    const gongRadius = 1.2;
    const gongThickness = 0.08;
    const baseWidth = 3.8;
    const baseHeight = 0.4;
    const baseDepth = 1.0;
    const postHeight = 4.0;

    let gongMesh;
    let bossMesh;

    const result = createProp(scene, physicsWorld, {
        name: 'Gong',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [baseWidth / 2, postHeight / 2, baseDepth / 2],
                offset: { y: baseHeight / 2 },
                materialTag: STATIC_MATERIAL.WOOD,
            },
            {
                type: 'cylinder',
                radius: gongRadius,
                halfHeight: gongThickness / 2,
                rotation: { z: Math.PI / 2 },
                materialTag: STATIC_MATERIAL.METAL,
            },
        ],
        build({ group }) {
            const brassMat = materials.brass();
            const woodMat = materials.wood();

            gongMesh = mesh(
                new THREE.CylinderGeometry(gongRadius, gongRadius, gongThickness, 32),
                brassMat,
                { rotation: { z: Math.PI / 2 }, name: 'GongDisc' }
            );
            group.add(gongMesh);

            bossMesh = mesh(
                new THREE.CylinderGeometry(0.35, 0.35, 0.12, 24),
                brassMat,
                { rotation: { z: Math.PI / 2 }, position: { x: 0.02 } }
            );
            group.add(bossMesh);

            const frameWidth = 3.5;
            const frameHeight = 0.3;
            const frameDepth = 0.3;
            group.add(
                mesh(new THREE.BoxGeometry(frameWidth, frameHeight, frameDepth), woodMat, {
                    position: { y: 2.0 },
                })
            );

            const postSize = 0.25;
            const postGeo = new THREE.BoxGeometry(postSize, postHeight, postSize);
            group.add(mesh(postGeo, woodMat, { position: { x: -1.5 } }));
            group.add(mesh(postGeo, woodMat, { position: { x: 1.5 } }));

            group.add(
                mesh(new THREE.BoxGeometry(baseWidth, baseHeight, baseDepth), woodMat, {
                    position: { y: -postHeight / 2 + baseHeight / 2 },
                })
            );

            const ropeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
            const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
            group.add(mesh(ropeGeo, ropeMat, { position: { x: -0.9, y: 1.6 } }));
            group.add(mesh(ropeGeo, ropeMat, { position: { x: 0.9, y: 1.6 } }));

            const malletHandle = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), woodMat);
            const malletHead = mesh(new THREE.SphereGeometry(0.15, 16, 16), brassMat, {
                position: { y: 0.6 },
            });
            const mallet = new THREE.Group();
            mallet.add(malletHandle);
            mallet.add(malletHead);
            mallet.position.set(1.8, -1.2, 0.3);
            mallet.rotation.z = -Math.PI / 4;
            mallet.rotation.x = Math.PI / 6;
            group.add(mallet);
        },
    });

    const { group } = result;
    const rings = [];
    const maxRings = 3;
    const ringGeo = new THREE.RingGeometry(0.1, 0.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });

    for (let i = 0; i < maxRings; i++) {
        const ring = new THREE.Mesh(ringGeo, ringMat.clone());
        ring.rotation.y = Math.PI / 2;
        ring.visible = false;
        group.add(ring);
        rings.push({
            mesh: ring,
            active: false,
            startTime: 0,
            delay: i * 0.15,
        });
    }

    const impactLight = new THREE.PointLight(0xffd700, 0, 8);
    impactLight.position.set(0, 0, 0.5);
    group.add(impactLight);

    let flashIntensity = 0;
    let isShaking = false;
    let shakeStartTime = 0;
    const shakeDuration = 0.5;

    const triggerGong = () => {
        const impactPos = new THREE.Vector3();
        group.getWorldPosition(impactPos);
        playPropImpact({
            surface: 'gong',
            volume: 0.85,
            position: { x: impactPos.x, y: impactPos.y, z: impactPos.z },
        });
        const now = performance.now() / 1000;
        rings.forEach((ring) => {
            ring.active = true;
            ring.startTime = now + ring.delay;
            ring.mesh.visible = true;
            ring.mesh.scale.set(1, 1, 1);
            ring.mesh.material.opacity = 0.8;
        });
        impactLight.intensity = 5;
        isShaking = true;
        shakeStartTime = now;
        flashIntensity = 0.3;
    };

    const update = (deltaTime, _elapsedTime) => {
        const now = performance.now() / 1000;

        rings.forEach((ring) => {
            if (!ring.active) return;
            const age = now - ring.startTime;
            if (age < 0) return;
            if (age > 1.5) {
                ring.active = false;
                ring.mesh.visible = false;
                return;
            }
            const scale = 1 + age * 4;
            ring.mesh.scale.set(scale, scale, scale);
            ring.mesh.material.opacity = 0.8 * (1 - age / 1.5);
        });

        if (impactLight.intensity > 0) {
            impactLight.intensity = Math.max(0, impactLight.intensity - deltaTime * 8);
        }

        if (isShaking) {
            const shakeAge = now - shakeStartTime;
            if (shakeAge < shakeDuration) {
                const intensity = 1 - shakeAge / shakeDuration;
                const shakeX = (Math.random() - 0.5) * 0.05 * intensity;
                const shakeY = (Math.random() - 0.5) * 0.05 * intensity;
                gongMesh.position.x = shakeX;
                gongMesh.position.y = shakeY;
                bossMesh.position.x = 0.02 + shakeX;
                bossMesh.position.y = shakeY;
            } else {
                isShaking = false;
                gongMesh.position.set(0, 0, 0);
                bossMesh.position.set(0.02, 0, 0);
            }
        }

        if (flashIntensity > 0) {
            flashIntensity = Math.max(0, flashIntensity - deltaTime * 3);
        }
    };

    const getFlashIntensity = () => flashIntensity;

    return {
        ...result,
        interact: triggerGong,
        update,
        getFlashIntensity,
    };
}
