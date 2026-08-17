import * as THREE from 'three';
import { createProp, materials, mesh, STATIC_MATERIAL } from './propKit.js';

export function createDrinkingHorn(
    scene,
    physicsWorld,
    position = { x: 0, y: -2.75, z: 0 },
    rotationY = 0
) {
    const width = 3.0;
    const height = 1.5;
    const depth = 1.0;

    const result = createProp(scene, physicsWorld, {
        name: 'DrinkingHorn',
        position,
        rotation: rotationY,
        footOffsetY: 0.5,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, height / 2, depth / 2],
                offset: { y: height / 2 - 0.5 },
                materialTag: STATIC_MATERIAL.DEFAULT,
            },
        ],
        build({ group }) {
            const hornMat = new THREE.MeshStandardMaterial({
                color: 0xe3d8c1,
                roughness: 0.3,
                metalness: 0.1,
                bumpScale: 0.05,
            });

            const brassMat = materials.brass();

            const curveRadius = 2.0;
            const curveArc = Math.PI / 1.5;

            class HornCurve extends THREE.Curve {
                constructor(scale = 1) {
                    super();
                    this.scale = scale;
                }
                getPoint(t, optionalTarget = new THREE.Vector3()) {
                    const angle = t * curveArc;
                    const x = Math.sin(angle) * curveRadius;
                    const y = Math.cos(angle) * curveRadius - curveRadius;
                    return optionalTarget.set(x, y, 0).multiplyScalar(this.scale);
                }
            }

            const path = new HornCurve(1.5);
            const segments = 32;
            const radialSegments = 16;
            const radiusBase = 0.5;

            const geometry = new THREE.BufferGeometry();
            const vertices = [];
            const indices = [];
            const normals = [];
            const uvs = [];

            const addVertex = (v, n, uv) => {
                vertices.push(v.x, v.y, v.z);
                normals.push(n.x, n.y, n.z);
                uvs.push(uv.x, uv.y);
            };

            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const currentRadius = radiusBase * (1.0 - t * 0.9);
                const pt = path.getPoint(t);
                const tangent = path.getTangent(t).normalize();

                const axis = new THREE.Vector3(0, 0, 1);
                let normal = new THREE.Vector3().crossVectors(tangent, axis).normalize();
                if (normal.lengthSq() < 0.001) {
                    normal = new THREE.Vector3()
                        .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
                        .normalize();
                }
                const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

                for (let j = 0; j <= radialSegments; j++) {
                    const v = j / radialSegments;
                    const theta = v * Math.PI * 2;
                    const sinTheta = Math.sin(theta);
                    const cosTheta = Math.cos(theta);

                    const vertexNormal = new THREE.Vector3()
                        .addScaledVector(normal, cosTheta)
                        .addScaledVector(binormal, sinTheta);

                    const positionLocal = new THREE.Vector3()
                        .copy(pt)
                        .addScaledVector(vertexNormal, currentRadius);

                    addVertex(positionLocal, vertexNormal, new THREE.Vector2(t, v));
                }
            }

            for (let i = 0; i < segments; i++) {
                for (let j = 0; j < radialSegments; j++) {
                    const a = i * (radialSegments + 1) + j;
                    const b = a + radialSegments + 1;
                    const c = b + 1;
                    const d = a + 1;
                    indices.push(a, b, d);
                    indices.push(b, c, d);
                }
            }

            geometry.setIndex(indices);
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

            const hornMesh = mesh(geometry, hornMat);
            const capGeo = new THREE.CircleGeometry(radiusBase - 0.02, radialSegments);
            const capMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
            const capMesh = mesh(capGeo, capMat);
            const ptStart = path.getPoint(0);
            const tanStart = path.getTangent(0);
            capMesh.position.copy(ptStart);
            capMesh.lookAt(ptStart.clone().sub(tanStart));

            const rimMesh = mesh(new THREE.TorusGeometry(radiusBase + 0.02, 0.05, 16, 32), brassMat);
            rimMesh.position.copy(ptStart);
            rimMesh.lookAt(ptStart.clone().add(tanStart));

            const midT = 0.4;
            const ptMid = path.getPoint(midT);
            const tanMid = path.getTangent(midT);
            const midRadius = radiusBase * (1.0 - midT * 0.9);
            const bandMesh = mesh(
                new THREE.TorusGeometry(midRadius + 0.02, 0.04, 16, 32),
                brassMat
            );
            bandMesh.position.copy(ptMid);
            bandMesh.lookAt(ptMid.clone().add(tanMid));

            const endT = 1.0;
            const ptEnd = path.getPoint(endT);
            const tanEnd = path.getTangent(endT);
            const endRadius = radiusBase * 0.1;
            const tipMesh = mesh(new THREE.ConeGeometry(endRadius + 0.03, 0.4, 16), brassMat);
            tipMesh.position.copy(ptEnd);
            tipMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tanEnd);
            tipMesh.position.add(tanEnd.clone().multiplyScalar(0.15));

            const standGroup = new THREE.Group();
            const standBase = mesh(
                new THREE.TorusGeometry(0.4, 0.05, 16, 32),
                brassMat,
                { rotation: { x: Math.PI / 2 }, position: { y: -0.5 } }
            );
            standGroup.add(standBase);

            const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8);
            for (let i = 0; i < 3; i++) {
                const leg = mesh(legGeo, brassMat);
                const angle = (i / 3) * Math.PI * 2;
                leg.position.set(Math.cos(angle) * 0.4, -0.2, Math.sin(angle) * 0.4);
                leg.rotation.x = Math.sin(angle) * 0.2;
                leg.rotation.z = -Math.cos(angle) * 0.2;
                standGroup.add(leg);
            }

            const hornAssembly = new THREE.Group();
            hornAssembly.add(hornMesh);
            hornAssembly.add(capMesh);
            hornAssembly.add(rimMesh);
            hornAssembly.add(bandMesh);
            hornAssembly.add(tipMesh);
            hornAssembly.position.set(-0.8, 0, 0);
            hornAssembly.rotation.z = Math.PI / 8;
            hornAssembly.rotation.x = Math.PI / 16;

            group.add(hornAssembly);
            group.add(standGroup);
        },
    });

    return result.group;
}
