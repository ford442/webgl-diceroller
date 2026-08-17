import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export const OrbMode = {
    ICE: 0,
    FIRE: 1,
    NATURE: 2,
    ARCANE: 3,
};

const MODE_COLORS = {
    [OrbMode.ICE]: { color: 0x44aaff, emissive: 0x1166cc, light: 0x4488ff },
    [OrbMode.FIRE]: { color: 0xff4422, emissive: 0xff1100, light: 0xff6622 },
    [OrbMode.NATURE]: { color: 0x44ff44, emissive: 0x22aa22, light: 0x66ff66 },
    [OrbMode.ARCANE]: { color: 0xaa44ff, emissive: 0x6600cc, light: 0xcc66ff },
};

const MODE_NAMES = {
    [OrbMode.ICE]: 'Ice',
    [OrbMode.FIRE]: 'Fire',
    [OrbMode.NATURE]: 'Nature',
    [OrbMode.ARCANE]: 'Arcane',
};

export function createMysticOrb(
    scene,
    physicsWorld,
    position = { x: 12, y: -2.75, z: 4 },
    rotationY = 0
) {
    const pedestalBaseRadius = 0.8;
    const pedestalBaseHeight = 0.2;
    const pedestalStemRadius = 0.3;
    const pedestalStemHeight = 1.0;
    const pedestalTopHeight = 0.15;
    const pedestalTotalHeight = pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight;
    const orbRadius = 0.35;

    let crystalMat;
    let coreMat;
    let orbLight;
    let orbMesh;
    let coreMesh;
    let currentMode = OrbMode.ICE;
    let orbFloatOffset = 0;
    const orbRotationSpeed = 0.5;
    const particles = [];
    let particleGroup;

    const result = createProp(scene, physicsWorld, {
        name: 'MysticOrb',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'cylinder',
                radius: pedestalBaseRadius,
                halfHeight: pedestalTotalHeight / 2,
                offset: { y: pedestalTotalHeight / 2 },
                materialTag: STATIC_MATERIAL.DEFAULT,
            },
        ],
        build({ group }) {
            const stoneMat = new THREE.MeshStandardMaterial({
                color: 0x444444,
                roughness: 0.9,
                metalness: 0.1,
            });
            const goldMat = materials.gold();

            crystalMat = new THREE.MeshPhysicalMaterial({
                color: MODE_COLORS[OrbMode.ICE].color,
                metalness: 0.1,
                roughness: 0.05,
                transmission: 0.7,
                thickness: 1.0,
                ior: 1.5,
                emissive: MODE_COLORS[OrbMode.ICE].emissive,
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.9,
            });

            group.add(
                mesh(
                    new THREE.CylinderGeometry(
                        pedestalBaseRadius,
                        pedestalBaseRadius * 1.2,
                        pedestalBaseHeight,
                        16
                    ),
                    stoneMat,
                    { position: { y: pedestalBaseHeight / 2 } }
                )
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(
                        pedestalStemRadius,
                        pedestalStemRadius * 0.8,
                        pedestalStemHeight,
                        12
                    ),
                    stoneMat,
                    { position: { y: pedestalBaseHeight + pedestalStemHeight / 2 } }
                )
            );

            const ringGeo = new THREE.TorusGeometry(pedestalStemRadius + 0.05, 0.04, 8, 16);
            group.add(
                mesh(ringGeo, goldMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { y: pedestalBaseHeight + pedestalStemHeight * 0.3 },
                })
            );
            group.add(
                mesh(ringGeo, goldMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { y: pedestalBaseHeight + pedestalStemHeight * 0.7 },
                })
            );

            group.add(
                mesh(
                    new THREE.CylinderGeometry(
                        0.5,
                        pedestalStemRadius,
                        pedestalTopHeight,
                        16
                    ),
                    stoneMat,
                    {
                        position: {
                            y: pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight / 2,
                        },
                    }
                )
            );

            group.add(
                mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), goldMat, {
                    rotation: { x: Math.PI / 2 },
                    position: { y: pedestalBaseHeight + pedestalStemHeight + pedestalTopHeight },
                })
            );

            orbMesh = mesh(new THREE.IcosahedronGeometry(orbRadius, 2), crystalMat, {
                position: {
                    y:
                        pedestalBaseHeight +
                        pedestalStemHeight +
                        pedestalTopHeight +
                        orbRadius +
                        0.3,
                },
            });
            group.add(orbMesh);

            coreMat = new THREE.MeshBasicMaterial({
                color: MODE_COLORS[OrbMode.ICE].light,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
            });
            coreMesh = mesh(new THREE.IcosahedronGeometry(orbRadius * 0.4, 0), coreMat);
            coreMesh.position.copy(orbMesh.position);
            group.add(coreMesh);

            orbLight = new THREE.PointLight(MODE_COLORS[OrbMode.ICE].light, 3, 6);
            orbLight.position.copy(orbMesh.position);
            group.add(orbLight);

            particleGroup = new THREE.Group();
            group.add(particleGroup);
        },
    });

    const particleGeos = {
        [OrbMode.ICE]: new THREE.OctahedronGeometry(0.03, 0),
        [OrbMode.FIRE]: new THREE.SphereGeometry(0.04, 6, 6),
        [OrbMode.NATURE]: new THREE.PlaneGeometry(0.06, 0.06),
        [OrbMode.ARCANE]: new THREE.TetrahedronGeometry(0.03, 0),
    };

    for (let i = 0; i < 50; i++) {
        particles.push({
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            life: Math.random(),
            maxLife: 1 + Math.random() * 2,
            size: 0.5 + Math.random() * 0.5,
            mesh: null,
        });
    }

    const createParticleMeshes = () => {
        while (particleGroup.children.length > 0) {
            const child = particleGroup.children[0];
            particleGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        const geo = particleGeos[currentMode];
        const color = MODE_COLORS[currentMode].light;

        particles.forEach((p) => {
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });
            p.mesh = mesh(geo, mat);
            p.mesh.visible = false;
            particleGroup.add(p.mesh);
        });
    };

    createParticleMeshes();

    const resetParticle = (p, burst = false) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.3 + Math.random() * 0.2;
        const height = orbMesh.position.y + (Math.random() - 0.5) * 0.3;
        p.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);

        switch (currentMode) {
            case OrbMode.ICE:
                p.velocity.set(
                    (Math.random() - 0.5) * 0.2,
                    burst ? (Math.random() - 0.3) * 0.5 : -0.1 - Math.random() * 0.2,
                    (Math.random() - 0.5) * 0.2
                );
                break;
            case OrbMode.FIRE:
                p.velocity.set(
                    (Math.random() - 0.5) * 0.3,
                    burst ? (Math.random() + 0.2) * 0.5 : 0.1 + Math.random() * 0.3,
                    (Math.random() - 0.5) * 0.3
                );
                break;
            case OrbMode.NATURE:
                p.velocity.set(
                    (Math.random() - 0.5) * 0.4,
                    burst ? (Math.random() - 0.5) * 0.4 : (Math.random() - 0.5) * 0.2,
                    (Math.random() - 0.5) * 0.4
                );
                break;
            case OrbMode.ARCANE: {
                const spiralAngle = Math.random() * Math.PI * 2;
                p.velocity.set(
                    Math.cos(spiralAngle) * 0.3,
                    burst ? (Math.random() - 0.2) * 0.4 : 0.05 + Math.random() * 0.1,
                    Math.sin(spiralAngle) * 0.3
                );
                break;
            }
        }

        p.life = p.maxLife;
        if (p.mesh) {
            p.mesh.visible = true;
            p.mesh.material.opacity = 0.8;
        }
    };

    const updateParticles = (deltaTime) => {
        particles.forEach((p) => {
            if (!p.mesh) return;
            if (p.life <= 0) resetParticle(p);
            p.position.addScaledVector(p.velocity, deltaTime);
            p.life -= deltaTime;

            if (currentMode === OrbMode.ARCANE && p.life > 0) {
                const time = performance.now() / 1000;
                p.position.x += Math.cos(time * 3 + p.life) * 0.01;
                p.position.z += Math.sin(time * 3 + p.life) * 0.01;
            } else if (currentMode === OrbMode.NATURE && p.life > 0) {
                p.mesh.rotation.x += deltaTime;
                p.mesh.rotation.y += deltaTime * 0.5;
            }

            p.mesh.position.copy(p.position);
            p.mesh.scale.setScalar(p.size * (p.life / p.maxLife));
            p.mesh.material.opacity = 0.8 * (p.life / p.maxLife);
        });
    };

    const cycleMode = () => {
        currentMode = (currentMode + 1) % 4;
        const colors = MODE_COLORS[currentMode];
        crystalMat.color.setHex(colors.color);
        crystalMat.emissive.setHex(colors.emissive);
        coreMat.color.setHex(colors.light);
        orbLight.color.setHex(colors.light);
        createParticleMeshes();
        particles.forEach((p) => {
            p.life = p.maxLife;
            resetParticle(p, true);
        });
        console.log(`[MysticOrb] Mode changed to: ${MODE_NAMES[currentMode]}`);
    };

    const update = (deltaTime, elapsedTime) => {
        orbFloatOffset += deltaTime;
        const floatY = Math.sin(orbFloatOffset * 1.5) * 0.05;
        orbMesh.position.y =
            pedestalBaseHeight +
            pedestalStemHeight +
            pedestalTopHeight +
            orbRadius +
            0.3 +
            floatY;
        coreMesh.position.copy(orbMesh.position);
        orbLight.position.copy(orbMesh.position);
        orbMesh.rotation.y += deltaTime * orbRotationSpeed;
        orbMesh.rotation.x = Math.sin(elapsedTime * 0.5) * 0.1;
        coreMesh.rotation.copy(orbMesh.rotation);
        updateParticles(deltaTime);
    };

    return {
        ...result,
        interact: cycleMode,
        update,
        getMode: () => currentMode,
        getModeName: () => MODE_NAMES[currentMode],
        OrbMode,
    };
}
