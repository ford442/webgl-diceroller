import * as THREE from 'three';
import { getAmmo } from '../physics.js';

export function createSpyglass(scene, physicsWorld, position = { x: 5, y: -2.75, z: 7 }, rotationY = Math.PI / 6) {
    const group = new THREE.Group();
    group.name = 'Spyglass';

    // Materials
    // Worn brass for the tubes
    const brassMaterial = new THREE.MeshStandardMaterial({
        color: 0xb5a642,
        metalness: 0.8,
        roughness: 0.3
    });

    // Dark leather wrap for the main body
    const leatherMaterial = new THREE.MeshStandardMaterial({
        color: 0x3d2314,
        roughness: 0.9,
        bumpScale: 0.05
    });

    // Glass for the lens
    const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.9, // glass-like transparency
        thickness: 0.5,
        transparent: true,
        opacity: 0.8
    });

    // Dimensions for the tubes (collapsible segments)
    // Spyglass will lie flat along the Z axis (which we rotate later)
    // The main body is the thickest, front part.
    const segments = [
        { radius: 0.3, length: 1.5, z: 1.0, material: leatherMaterial }, // Main body (front)
        { radius: 0.25, length: 1.2, z: -0.1, material: brassMaterial }, // Middle tube
        { radius: 0.2, length: 1.0, z: -1.0, material: brassMaterial }   // Eyepiece tube
    ];

    segments.forEach(seg => {
        // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
        // Default orientation for cylinder is along Y axis. We need to rotate it to lie flat.
        const geo = new THREE.CylinderGeometry(seg.radius, seg.radius, seg.length, 16);
        const mesh = new THREE.Mesh(geo, seg.material);

        // Orient to lay flat along Z axis
        mesh.rotation.x = Math.PI / 2;
        mesh.position.z = seg.z;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        group.add(mesh);
    });

    // Brass rings to separate segments
    const ringGeo1 = new THREE.TorusGeometry(0.31, 0.03, 8, 24);
    const ring1 = new THREE.Mesh(ringGeo1, brassMaterial);
    ring1.position.z = 1.75; // Front end of main body
    group.add(ring1);

    const ringGeo2 = new THREE.TorusGeometry(0.31, 0.03, 8, 24);
    const ring2 = new THREE.Mesh(ringGeo2, brassMaterial);
    ring2.position.z = 0.25; // Back end of main body
    group.add(ring2);

    const ringGeo3 = new THREE.TorusGeometry(0.26, 0.02, 8, 24);
    const ring3 = new THREE.Mesh(ringGeo3, brassMaterial);
    ring3.position.z = -0.7; // Back end of middle tube
    group.add(ring3);

    const ringGeo4 = new THREE.TorusGeometry(0.21, 0.02, 8, 24);
    const ring4 = new THREE.Mesh(ringGeo4, brassMaterial);
    ring4.position.z = -1.5; // Eyepiece end
    group.add(ring4);

    // Objective Lens (front)
    const lensGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.05, 16);
    const lens = new THREE.Mesh(lensGeo, glassMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 1.73; // Just inside the front tube
    group.add(lens);

    // Position and Rotation
    group.position.set(position.x, position.y + 0.3, position.z); // Lift by radius so it rests on the table
    group.rotation.y = rotationY;

    // We tilt it slightly or let physics handle it. We will use a static physics body aligned perfectly.
    // However, if we just lay it flat, rotation X/Z can be 0.

    scene.add(group);

    // Physics
    if (physicsWorld) {
        const Ammo = getAmmo();
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(group.position.x, group.position.y, group.position.z));

        // Note: btCylinderShape expects a vector indicating half-extents.
        // And it is oriented along the Y axis by default.
        // Since our spyglass is lying flat along its local Z axis (due to rotation X on the meshes),
        // we can either set the shape as a Z-cylinder, or just rotate the physics shape.
        // Actually, the simplest way is to create the meshes oriented along Y initially,
        // build the Y-cylinder shape, and then apply a group rotation (e.g. rotate X 90 degrees) to BOTH group and physics shape.

        // Let's adjust to the standard pattern:
        // We will rotate the entire group to lie flat.

        // The total length is roughly from z=1.75 to z=-1.5 = 3.25.
        // Center is at roughly z = 0.125.
        // We will use a box or a cylinder aligned along Z.
        // Bullet btCylinderShapeZ takes half-extents: (radius, radius, halfLength)
        const radius = 0.31;
        const halfLength = 1.65;
        const shape = new Ammo.btCylinderShapeZ(new Ammo.btVector3(radius, radius, halfLength));

        // Group quaternion
        const quat = group.quaternion;
        transform.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));

        const mass = 0; // Static
        const localInertia = new Ammo.btVector3(0, 0, 0);
        const motionState = new Ammo.btDefaultMotionState(transform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        const body = new Ammo.btRigidBody(rbInfo);

        body.setFriction(0.6);
        body.setRestitution(0.1);

        physicsWorld.addRigidBody(body);
    }

    return { group };
}
