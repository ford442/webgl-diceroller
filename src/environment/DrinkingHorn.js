import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createDrinkingHorn(scene, physicsWorld, position = { x: 0, y: -2.75, z: 0 }, rotationY = 0) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'DrinkingHorn';

    // Materials
    // Horn material: bone/ivory with slight subsurface scattering feel
    const hornMat = new THREE.MeshStandardMaterial({
        color: 0xe3d8c1,
        roughness: 0.3,
        metalness: 0.1,
        bumpScale: 0.05
    });

    // Metal fittings (brass/bronze)
    const brassMat = new THREE.MeshStandardMaterial({
        color: 0xb5a642, // Brass
        metalness: 1.0,
        roughness: 0.3,
        envMapIntensity: 1.2
    });

    // Leather strap/wrapping
    const leatherMat = new THREE.MeshStandardMaterial({
        color: 0x3f1f1f, // Dark leather
        roughness: 0.9,
        metalness: 0.0
    });

    // 1. Horn Body (LatheGeometry twisted along path)
    // To make a curved horn, we use a TubeGeometry along a curve instead of a Lathe
    const curveRadius = 2.0;
    const curveArc = Math.PI / 1.5; // Curve of the horn

    // Create a path that tapers
    class HornCurve extends THREE.Curve {
        constructor(scale = 1) {
            super();
            this.scale = scale;
        }
        getPoint(t, optionalTarget = new THREE.Vector3()) {
            const angle = t * curveArc;
            // Radius of the curve path
            const x = Math.sin(angle) * curveRadius;
            const y = Math.cos(angle) * curveRadius - curveRadius;
            const z = 0;
            return optionalTarget.set(x, y, z).multiplyScalar(this.scale);
        }
    }

    const path = new HornCurve(1.5);

    // We cannot easily taper a TubeGeometry using built-in three.js without custom geometry.
    // Instead, let's create a custom geometry by sweeping circles along the curve with decreasing radius
    const segments = 32;
    const radialSegments = 16;
    const pts = [];
    const radiusBase = 0.5;

    // Build vertices and faces manually for a tapered horn
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];
    const normals = [];
    const uvs = [];

    // Helper to add a vertex
    const addVertex = (v, n, uv) => {
        vertices.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(uv.x, uv.y);
    };

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const currentRadius = radiusBase * (1.0 - t * 0.9); // Taper to 10%
        const pt = path.getPoint(t);
        const tangent = path.getTangent(t).normalize();

        // Calculate normal and binormal
        const axis = new THREE.Vector3(0, 0, 1);
        let normal = new THREE.Vector3().crossVectors(tangent, axis).normalize();
        if (normal.lengthSq() < 0.001) {
            normal = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
        }
        const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

        for (let j = 0; j <= radialSegments; j++) {
            const v = j / radialSegments;
            const theta = v * Math.PI * 2;

            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            // Calculate vertex position
            const vertexNormal = new THREE.Vector3()
                .addScaledVector(normal, cosTheta)
                .addScaledVector(binormal, sinTheta);

            const positionLocal = new THREE.Vector3()
                .copy(pt)
                .addScaledVector(vertexNormal, currentRadius);

            addVertex(positionLocal, vertexNormal, new THREE.Vector2(t, v));
        }
    }

    // Build indices
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
    // The uvs variable was not defined properly, but we don't strictly need them since we aren't using a complex texture,
    // only a basic color material. However, adding basic UVs avoids warnings.
    const uvArray = new Float32Array(uvs.length * 2);
    for(let k=0; k<uvs.length; k+=2){
        uvArray[k] = uvs[k];
        uvArray[k+1] = uvs[k+1];
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    const hornMesh = new THREE.Mesh(geometry, hornMat);
    hornMesh.castShadow = true;
    hornMesh.receiveShadow = true;

    // Cap the wide end (top)
    const capGeo = new THREE.CircleGeometry(radiusBase - 0.02, radialSegments);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const capMesh = new THREE.Mesh(capGeo, capMat);
    // Move to the start point of curve and point outwards
    const ptStart = path.getPoint(0);
    const tanStart = path.getTangent(0);
    capMesh.position.copy(ptStart);
    capMesh.lookAt(ptStart.clone().sub(tanStart)); // Look backward

    // Add rim (metal ring at the opening)
    const rimGeo = new THREE.TorusGeometry(radiusBase + 0.02, 0.05, 16, 32);
    const rimMesh = new THREE.Mesh(rimGeo, brassMat);
    rimMesh.position.copy(ptStart);
    rimMesh.lookAt(ptStart.clone().add(tanStart));
    rimMesh.castShadow = true;

    // Add another metal band around the middle
    const midT = 0.4;
    const ptMid = path.getPoint(midT);
    const tanMid = path.getTangent(midT);
    const midRadius = radiusBase * (1.0 - midT * 0.9);
    const bandGeo = new THREE.TorusGeometry(midRadius + 0.02, 0.04, 16, 32);
    const bandMesh = new THREE.Mesh(bandGeo, brassMat);
    bandMesh.position.copy(ptMid);
    bandMesh.lookAt(ptMid.clone().add(tanMid));
    bandMesh.castShadow = true;

    // Add an ornate tip (metal cap at the small end)
    const endT = 1.0;
    const ptEnd = path.getPoint(endT);
    const tanEnd = path.getTangent(endT);
    const endRadius = radiusBase * 0.1; // 10%
    const tipGeo = new THREE.ConeGeometry(endRadius + 0.03, 0.4, 16);
    const tipMesh = new THREE.Mesh(tipGeo, brassMat);
    tipMesh.position.copy(ptEnd);
    // Align cone to tangent
    tipMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tanEnd);
    tipMesh.position.add(tanEnd.clone().multiplyScalar(0.15)); // Shift down
    tipMesh.castShadow = true;

    // Stand (Iron/Brass display stand)
    const standGroup = new THREE.Group();
    // Base ring
    const standBaseGeo = new THREE.TorusGeometry(0.4, 0.05, 16, 32);
    const standBase = new THREE.Mesh(standBaseGeo, brassMat);
    standBase.rotation.x = Math.PI / 2;
    standBase.position.y = -0.5; // Offset below the horn
    standBase.castShadow = true;
    standGroup.add(standBase);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8);
    for(let i=0; i<3; i++) {
        const leg = new THREE.Mesh(legGeo, brassMat);
        const angle = (i / 3) * Math.PI * 2;
        const x = Math.cos(angle) * 0.4;
        const z = Math.sin(angle) * 0.4;
        leg.position.set(x, -0.2, z);
        leg.rotation.x = Math.sin(angle) * 0.2; // Slight splay outward
        leg.rotation.z = -Math.cos(angle) * 0.2;
        leg.castShadow = true;
        standGroup.add(leg);
    }

    // Add horn and stand to group
    const hornAssembly = new THREE.Group();
    hornAssembly.add(hornMesh);
    hornAssembly.add(capMesh);
    hornAssembly.add(rimMesh);
    hornAssembly.add(bandMesh);
    hornAssembly.add(tipMesh);

    // Adjust horn position to sit in the stand
    // The horn's center of gravity is somewhere along the curve.
    // We'll manually tweak the offset.
    hornAssembly.position.set(-0.8, 0, 0);
    hornAssembly.rotation.z = Math.PI / 8; // Tilt slightly up
    hornAssembly.rotation.x = Math.PI / 16;

    group.add(hornAssembly);
    group.add(standGroup);

    // Final Placement
    group.position.set(position.x, position.y + 0.5, position.z); // Adjust Y so base sits on table
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics
    // The shape is complex, but a simple BoxShape works well for static collision
    // Covering the bounding volume of the horn and stand
    const width = 3.0; // Along X roughly
    const height = 1.5; // Y
    const depth = 1.0; // Z
    if (ammo && physicsWorld) {
        const shape = new ammo.btBoxShape(new ammo.btVector3(width / 2, height / 2, depth / 2));
    
        // Because the group's center is at the base ring (Y = -0.5), we need to shift the physical shape up
        // to match the visual mass
        // But createStaticBody just uses the group's transform. To offset the shape, we can create a proxy mesh.
    
        const proxyMesh = new THREE.Mesh();
        proxyMesh.position.copy(group.position);
        proxyMesh.position.y += height/2 - 0.5; // Shift center of mass up
        proxyMesh.rotation.copy(group.rotation);
    
        createStaticBody(physicsWorld, proxyMesh, shape);
    }

    return group;
}
