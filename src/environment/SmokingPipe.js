import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createSmokingPipe(
    scene,
    physicsWorld,
    position = { x: -6, y: -2.75, z: 5 },
    rotation = Math.PI / 8
) {
    const smokeParticles = [];

    return createProp(scene, physicsWorld, {
        name: 'SmokingPipe',
        position,
        rotation,
        colliders: [
            {
                type: 'box',
                halfExtents: [0.35, 0.5, 0.35],
                offset: { x: -0.8, y: 0.5, z: 0 },
            },
            {
                type: 'box',
                halfExtents: [0.6, 0.1, 0.1],
                offset: { x: 0.2, y: 0.3, z: 0 },
                rotation: { y: -Math.PI / 6 },
            },
            {
                type: 'box',
                halfExtents: [0.5, 0.3, 0.35],
                offset: { x: 0.6, y: 0.15, z: 0.3 },
            },
        ],
        build({ group }) {
            const woodMat = new THREE.MeshStandardMaterial({
                color: 0x8b4513,
                roughness: 0.6,
                metalness: 0.1,
            });
            const darkWoodMat = new THREE.MeshStandardMaterial({
                color: 0x5d3a1a,
                roughness: 0.7,
                metalness: 0.1,
            });
            const leatherMat = new THREE.MeshStandardMaterial({
                color: 0x8b4513,
                roughness: 0.9,
                bumpScale: 0.05,
            });
            const tobaccoMat = new THREE.MeshStandardMaterial({
                color: 0x3d2314,
                roughness: 1.0,
            });

            const pipeGroup = new THREE.Group();
            const bowlPoints = [];
            for (let i = 0; i <= 10; i++) {
                const t = i / 10;
                const angle = Math.PI * t;
                const r = Math.sin(angle) * 0.35;
                const y = -Math.cos(angle) * 0.5 + 0.5;
                bowlPoints.push(new THREE.Vector2(r, y));
            }
            const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlPoints, 16), woodMat);
            bowl.castShadow = true;
            bowl.receiveShadow = true;
            pipeGroup.add(bowl);

            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 8, 16), darkWoodMat);
            rim.rotation.x = Math.PI / 2;
            rim.position.y = 1.0;
            rim.castShadow = true;
            pipeGroup.add(rim);

            const tobacco = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), tobaccoMat);
            tobacco.rotation.x = -Math.PI / 2;
            tobacco.position.y = 0.95;
            pipeGroup.add(tobacco);

            const curve = new THREE.QuadraticBezierCurve3(
                new THREE.Vector3(0.25, 0.8, 0),
                new THREE.Vector3(0.8, 1.0, 0),
                new THREE.Vector3(1.8, 0.3, 0)
            );
            const stem = new THREE.Mesh(
                new THREE.TubeGeometry(curve, 16, 0.08, 8, false),
                darkWoodMat
            );
            stem.castShadow = true;
            stem.receiveShadow = true;
            pipeGroup.add(stem);

            const mouthpiece = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.08, 0.4, 8),
                woodMat
            );
            mouthpiece.rotation.z = Math.PI / 2 + 0.3;
            mouthpiece.position.set(1.9, 0.25, 0);
            mouthpiece.castShadow = true;
            pipeGroup.add(mouthpiece);

            pipeGroup.position.set(-0.8, 0, 0);
            pipeGroup.rotation.y = -Math.PI / 6;
            group.add(pipeGroup);

            const pouchGroup = new THREE.Group();
            const pouchGeo = new THREE.SphereGeometry(0.5, 16, 12);
            const pouchPositions = pouchGeo.attributes.position;
            for (let i = 0; i < pouchPositions.count; i++) {
                const y = pouchPositions.getY(i);
                if (y < 0) pouchPositions.setY(i, y * 0.3);
            }
            pouchGeo.computeVertexNormals();

            const pouch = new THREE.Mesh(pouchGeo, leatherMat);
            pouch.scale.set(1, 0.8, 0.6);
            pouch.castShadow = true;
            pouch.receiveShadow = true;
            pouchGroup.add(pouch);

            const cuff = new THREE.Mesh(
                new THREE.CylinderGeometry(0.35, 0.4, 0.2, 16),
                darkWoodMat
            );
            cuff.position.y = 0.25;
            cuff.castShadow = true;
            pouchGroup.add(cuff);

            const drawstringCurve = new THREE.EllipseCurve(
                0,
                0,
                0.32,
                0.32,
                0,
                2 * Math.PI,
                false,
                0
            );
            const drawstringGeo = new THREE.BufferGeometry().setFromPoints(
                drawstringCurve.getPoints(32).map((p) => new THREE.Vector3(p.x, 0, p.y))
            );
            const drawstring = new THREE.Line(
                drawstringGeo,
                new THREE.LineBasicMaterial({ color: 0x3d2314 })
            );
            drawstring.position.y = 0.35;
            pouchGroup.add(drawstring);

            for (let i = 0; i < 5; i++) {
                const flake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.08), tobaccoMat);
                const angle = Math.random() * Math.PI * 2;
                const dist = 0.6 + Math.random() * 0.4;
                flake.position.set(Math.cos(angle) * dist, 0.01, Math.sin(angle) * dist);
                flake.rotation.y = Math.random() * Math.PI;
                flake.rotation.x = Math.random() * 0.3;
                flake.castShadow = true;
                pouchGroup.add(flake);
            }

            pouchGroup.position.set(0.6, 0, 0.3);
            pouchGroup.rotation.y = Math.PI / 4;
            group.add(pouchGroup);

            const smokeGroup = new THREE.Group();
            group.add(smokeGroup);
            const smokeGeo = new THREE.SphereGeometry(0.05, 6, 6);
            const smokeMat = new THREE.MeshBasicMaterial({
                color: 0xaaaaaa,
                transparent: true,
                opacity: 0.3,
            });

            for (let i = 0; i < 8; i++) {
                const smoke = new THREE.Mesh(smokeGeo, smokeMat);
                smoke.position.set(
                    -0.8 + Math.cos(rotation) * 0.2,
                    1.2 + Math.random() * 0.5,
                    0 + Math.sin(rotation) * 0.2
                );
                smoke.userData = {
                    initialY: smoke.position.y,
                    speed: 0.2 + Math.random() * 0.3,
                    offset: Math.random() * Math.PI * 2,
                    life: Math.random(),
                };
                smokeGroup.add(smoke);
                smokeParticles.push(smoke);
            }
        },
        update(time) {
            smokeParticles.forEach((smoke) => {
                const data = smoke.userData;
                data.life += 0.01;
                if (data.life > 1) {
                    data.life = 0;
                    smoke.position.set(
                        -0.8 + (Math.random() - 0.5) * 0.1,
                        1.0,
                        (Math.random() - 0.5) * 0.1
                    );
                    smoke.scale.setScalar(1);
                }
                smoke.position.y += data.speed * 0.016;
                smoke.position.x += Math.sin(time * 2 + data.offset) * 0.002;
                smoke.scale.setScalar(1 + data.life * 2);
                smoke.material.opacity = 0.3 * (1 - data.life);
            });
        },
    });
}
