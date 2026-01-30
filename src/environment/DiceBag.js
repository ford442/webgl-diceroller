import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createDiceBag(scene, physicsWorld) {
    const group = new THREE.Group();
    const loader = new THREE.TextureLoader();

    // Reuse wood bump map for leather grain texture
    const leatherBump = loader.load('./images/wood_bump.jpg');
    leatherBump.wrapS = THREE.RepeatWrapping;
    leatherBump.wrapT = THREE.RepeatWrapping;
    leatherBump.repeat.set(2, 2);

    const leatherMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513, // Saddle Brown
        roughness: 0.9,
        bumpMap: leatherBump,
        bumpScale: 0.05
    });

    const stringMaterial = new THREE.MeshStandardMaterial({
        color: 0xD2B48C, // Tan
        roughness: 0.8
    });

    // 1. Bag Body (Sphere, slightly flattened)
    const radius = 1.0;
    const bodyGeo = new THREE.SphereGeometry(radius, 32, 16);
    // Flatten bottom
    bodyGeo.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.8, 1));

    const bodyMesh = new THREE.Mesh(bodyGeo, leatherMaterial);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    // Position so bottom sits on 0 (local)
    // Radius is 1, scaled Y is 0.8. Height is 1.6.
    // Center is at 0. Bottom is at -0.8.
    // We want bottom at 0. So shift up 0.8.
    bodyMesh.position.y = 0.8;
    group.add(bodyMesh);

    // 2. Drawstring / Neck
    const neckGeo = new THREE.CylinderGeometry(0.7, 0.9, 0.5, 32, 1, true);
    const neckMesh = new THREE.Mesh(neckGeo, leatherMaterial);
    neckMesh.position.y = 1.5; // On top of body
    neckMesh.castShadow = true;
    neckMesh.receiveShadow = true;
    group.add(neckMesh);

    // 3. String (Torus)
    const stringGeo = new THREE.TorusGeometry(0.7, 0.05, 16, 32);
    const stringMesh = new THREE.Mesh(stringGeo, stringMaterial);
    stringMesh.position.y = 1.5;
    stringMesh.rotation.x = Math.PI / 2;
    stringMesh.castShadow = true;
    stringMesh.receiveShadow = true;
    group.add(stringMesh);

    // Position on Table
    // Table surface is at -2.75 (approx).
    // Let's place it near the edge.
    group.position.set(-6, -2.75, 2);
    // Random rotation
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    const ammo = getAmmo();
    if (ammo) {
        // Approximate with a Cylinder or Sphere
        // Sphere is easier for dice to roll off
        const shape = new ammo.btSphereShape(radius);
        // Note: Physics shape origin is center of mass.
        // Our visual mesh center is at Y=0.8 (local).
        // The group is at Y=-2.75.
        // If we make a static body for the Group, the shape is centered at Group origin.
        // So the sphere will be centered at -2.75.
        // But our visual sphere is centered at -2.75 + 0.8 = -1.95.
        // We need to offset the shape or the body?
        // createStaticBody uses mesh.position.
        // If we pass 'group', it uses group.position (-6, -2.75, 2).
        // The shape will be centered there.
        // The visual sphere center is at Y=0.8 relative to that.
        // So the physics sphere will be at the bottom of the visual sphere.
        // That means the visual sphere will float above the physics sphere?
        // No, visual is UP. Physics is DOWN.
        // Visual starts at 0 (bottom) goes to 1.6.
        // Physics sphere (radius 1) goes from -1 to 1.
        // We want physics sphere to match visual.
        // Physics center should be at local Y=0.8.

        // createStaticBody implementation:
        // transform.setOrigin(mesh.position)
        // It doesn't support offset shape.

        // We can use a Compound Shape or just create the body on the bodyMesh instead of the group?
        // If we use bodyMesh, we need its world position.
        // bodyMesh.position is local (0, 0.8, 0).
        // World position is group.position + local.
        // But createStaticBody reads mesh.position. If mesh is child, mesh.position is local.
        // We should calculate world position.

        // Let's use a workaround: Create a hidden mesh for physics that is centered correctly.
        // Or just adjust the group so center is at center of mass.

        // Let's adjust group.
        // Shift visuals so center is 0.
        bodyMesh.position.y = 0; // Center at 0.
        neckMesh.position.y = 0.7;
        stringMesh.position.y = 0.7;

        // Visual bottom is now at -0.8.
        // To sit on table (-2.75), Group Y must be -2.75 + 0.8 = -1.95.
        group.position.set(-6, -1.95, 2);

        createStaticBody(physicsWorld, group, shape);
    }

    return group;
}
