import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createMiniature(scene, physicsWorld) {
    const ammo = getAmmo();
    const group = new THREE.Group();
    group.name = 'Miniature';

    // Materials
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x111111, // Black base
        roughness: 0.9,
    });

    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x888888, // Unpainted grey plastic/pewter
        roughness: 0.6,
        metalness: 0.3,
    });

    // Dimensions
    const baseRadius = 0.4;
    const baseHeight = 0.1;
    const bodyRadius = 0.2;
    const bodyHeight = 0.8;
    const headRadius = 0.25;

    // 1. Base (Cylinder)
    const baseGeo = new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 16);
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    // Cylinder is centered at origin. Shift up so bottom is at Y=0.
    baseMesh.position.y = baseHeight / 2;
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Body (Cylinder / Cone)
    const bodyGeo = new THREE.CylinderGeometry(bodyRadius * 0.5, bodyRadius, bodyHeight, 16);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = baseHeight + bodyHeight / 2;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // 3. Head (Sphere)
    const headGeo = new THREE.SphereGeometry(headRadius, 16, 16);
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.position.y = baseHeight + bodyHeight + headRadius;
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    group.add(headMesh);

    // Position on table
    // Table Top -2.75.
    // Group origin (Y=0 local) is the bottom of the base.
    group.position.set(3, -2.75, 4);

    // Give it a random rotation around Y
    group.rotation.y = Math.random() * Math.PI * 2;

    scene.add(group);

    // Physics
    // A cylinder shape that covers the whole miniature for simplicity.
    const totalHeight = baseHeight + bodyHeight + headRadius * 2;
    // For Ammo.btCylinderShape, Y axis is the height. The argument is half-extents.
    const shape = new ammo.btCylinderShape(new ammo.btVector3(baseRadius, totalHeight / 2, baseRadius));

    // Wait, the group's position is the *bottom* of the miniature.
    // Ammo's createStaticBody sets the physics body's origin to the group's position.
    // A btCylinderShape is centered at its origin. So if we attach it to the group,
    // the physics cylinder will be centered at -2.75, and extending down into the table!
    // Let's create a dummy mesh at the center of the miniature for physics, or adjust.
    // Since createStaticBody expects a mesh/group to grab position/quaternion, we can create
    // an invisible dummy mesh inside the group, but wait, if it's inside the group,
    // its world position is offset. But createStaticBody just reads mesh.position (local)
    // unless we pass world coords. Wait, src/physics.js createStaticBody does:
    // transform.setOrigin(new AmmoInstance.btVector3(mesh.position.x, mesh.position.y, mesh.position.z));
    // It assumes `mesh.position` is world space. So we must pass an object that is in world space.

    // Let's create an invisible dummy Mesh directly in the scene, just for physics.
    const dummyGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const dummyMat = new THREE.MeshBasicMaterial({ visible: false });
    const physMesh = new THREE.Mesh(dummyGeo, dummyMat);

    // Set physMesh world position to the center of the miniature.
    physMesh.position.copy(group.position);
    physMesh.position.y += totalHeight / 2;
    physMesh.rotation.copy(group.rotation);
    scene.add(physMesh);

    createStaticBody(physicsWorld, physMesh, shape);
}
