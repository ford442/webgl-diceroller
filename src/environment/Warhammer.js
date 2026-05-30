import * as THREE from 'three';
import { createStaticBody } from '../physics.js';
import { getAmmo } from '../physics.js';

export function createWarhammer(scene, physicsWorld, position, rotationAngle) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationAngle;
    group.name = 'Warhammer';

    // Materials
    const ironMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a,
        metalness: 0.8,
        roughness: 0.4
    });

    const woodMaterial = new THREE.MeshStandardMaterial({
        color: 0x3d2314,
        roughness: 0.9,
        metalness: 0.0
    });

    const leatherMaterial = new THREE.MeshStandardMaterial({
        color: 0x221100,
        roughness: 0.8,
        metalness: 0.1
    });

    // 1. Handle (Wood)
    const handleLength = 6.0;
    const handleRadius = 0.2;
    const handleGeo = new THREE.CylinderGeometry(handleRadius, handleRadius * 0.9, handleLength, 16);
    const handle = new THREE.Mesh(handleGeo, woodMaterial);
    handle.rotation.z = Math.PI / 2; // Lie flat
    handle.position.y = handleRadius; // Rest on table
    handle.castShadow = true;
    handle.receiveShadow = true;
    group.add(handle);

    // Leather Grip
    const gripLength = 2.0;
    const gripGeo = new THREE.CylinderGeometry(handleRadius * 1.1, handleRadius * 1.1, gripLength, 16);
    const grip = new THREE.Mesh(gripGeo, leatherMaterial);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = -handleLength / 4; // Towards the bottom
    grip.position.y = handleRadius;
    grip.castShadow = true;
    grip.receiveShadow = true;
    group.add(grip);

    // 2. Hammer Head (Iron)
    const headWidth = 1.2;
    const headHeight = 1.2;
    const headDepth = 2.5;
    const headGeo = new THREE.BoxGeometry(headWidth, headHeight, headDepth);
    const head = new THREE.Mesh(headGeo, ironMaterial);
    head.position.x = handleLength / 2; // Top of the handle
    head.position.y = headHeight / 2; // Rest on table
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    // 3. Pommel (Iron)
    const pommelRadius = 0.3;
    const pommelGeo = new THREE.SphereGeometry(pommelRadius, 16, 16);
    const pommel = new THREE.Mesh(pommelGeo, ironMaterial);
    pommel.position.x = -handleLength / 2; // Bottom of handle
    pommel.position.y = handleRadius;
    pommel.castShadow = true;
    pommel.receiveShadow = true;
    group.add(pommel);

    scene.add(group);

    // --- Ammo.js Physics ---
    const Ammo = getAmmo();
    const transform = new Ammo.btTransform();
    transform.setIdentity();

    // Collider uses a slightly simplified convex hull / compound shape
    // to match the visual geometry while keeping Ammo.js performance reasonable.
    // Visual mesh uses full PBR materials.
    // For simplicity, we can use a btCompoundShape or just a single box that covers it all.
    // Total length: handleLength + pommel + head depth ~ 7.0
    // Total width/height based on head: 2.5, 1.2

    // Half extents
    const hx = (handleLength + pommelRadius * 2) / 2;
    const hy = headHeight / 2;
    const hz = headDepth / 2;

    const shape = new Ammo.btBoxShape(new Ammo.btVector3(hx, hy, hz));

    const compoundShape = new Ammo.btCompoundShape();

    const localTransform = new Ammo.btTransform();
    localTransform.setIdentity();
    // Offset the collision shape up so its bottom touches the group's origin
    localTransform.setOrigin(new Ammo.btVector3(0, hy, 0));

    compoundShape.addChildShape(localTransform, shape);

    const body = createStaticBody(physicsWorld, group, compoundShape);

    return {
        group,
        body
    };
}
