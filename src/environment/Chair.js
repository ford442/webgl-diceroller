import * as THREE from 'three';
import { getAmmo } from '../physics.js';

export function createChair(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    const chairGroup = new THREE.Group();

    // Dimensions
    const seatHeight = 4.0;
    const seatWidth = 3.5;
    const seatDepth = 3.5;
    const legWidth = 0.4;
    const backHeight = 5.0;

    // Texture Loading (Reuse existing wood textures if available, otherwise fallback)
    const textureLoader = new THREE.TextureLoader();
    const woodDiffuse = textureLoader.load('/images/wood_diffuse.jpg');
    const woodNormal = textureLoader.load('/images/wood_normal.jpg');
    const woodRoughness = textureLoader.load('/images/wood_rough.jpg');

    const material = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        normalMap: woodNormal,
        roughnessMap: woodRoughness,
        roughness: 0.8,
        color: 0x553311 // Darker wood tint
    });

    // Seat
    const seatGeo = new THREE.BoxGeometry(seatWidth, 0.3, seatDepth);
    const seat = new THREE.Mesh(seatGeo, material);
    seat.position.y = seatHeight;
    seat.castShadow = true;
    seat.receiveShadow = true;
    chairGroup.add(seat);

    // Legs (4)
    const legGeo = new THREE.BoxGeometry(legWidth, seatHeight, legWidth);

    const positions = [
        { x: -seatWidth/2 + legWidth/2, z: -seatDepth/2 + legWidth/2 },
        { x: seatWidth/2 - legWidth/2, z: -seatDepth/2 + legWidth/2 },
        { x: -seatWidth/2 + legWidth/2, z: seatDepth/2 - legWidth/2 },
        { x: seatWidth/2 - legWidth/2, z: seatDepth/2 - legWidth/2 }
    ];

    positions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, material);
        leg.position.set(pos.x, seatHeight/2, pos.z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        chairGroup.add(leg);
    });

    // Backrest
    const backSupportGeo = new THREE.BoxGeometry(legWidth, backHeight, legWidth);
    const backPlankGeo = new THREE.BoxGeometry(seatWidth, 1.5, 0.2);

    // Back Supports (Extensions of rear legs)
    const rearPositions = [
        { x: -seatWidth/2 + legWidth/2, z: -seatDepth/2 + legWidth/2 },
        { x: seatWidth/2 - legWidth/2, z: -seatDepth/2 + legWidth/2 }
    ];

    rearPositions.forEach(pos => {
        const support = new THREE.Mesh(backSupportGeo, material);
        support.position.set(pos.x, seatHeight + backHeight/2, pos.z);
        support.castShadow = true;
        support.receiveShadow = true;
        chairGroup.add(support);
    });

    // Back Planks (Horizontal)
    const plank1 = new THREE.Mesh(backPlankGeo, material);
    plank1.position.set(0, seatHeight + backHeight - 0.5, -seatDepth/2 + legWidth/2);
    plank1.castShadow = true;
    chairGroup.add(plank1);

    const plank2 = new THREE.Mesh(backPlankGeo, material);
    plank2.position.set(0, seatHeight + backHeight/2, -seatDepth/2 + legWidth/2);
    plank2.castShadow = true;
    chairGroup.add(plank2);

    // Positioning
    chairGroup.position.set(position.x, position.y, position.z);
    chairGroup.rotation.y = rotationY;
    scene.add(chairGroup);

    // Physics
    // Simple Box Collider for the whole chair approx
    if (physicsWorld) {
        const Ammo = getAmmo();
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        // Center the collider vertically based on total height
        const totalHeight = seatHeight + backHeight;
        transform.setOrigin(new Ammo.btVector3(position.x, position.y + totalHeight / 2, position.z));

        // Rotation
        const q = new THREE.Quaternion();
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
        transform.setRotation(new Ammo.btQuaternion(q.x, q.y, q.z, q.w));

        const size = new THREE.Vector3(seatWidth/2, seatHeight/2 + backHeight/2, seatDepth/2);
        const shape = new Ammo.btBoxShape(new Ammo.btVector3(size.x, size.y, size.z));

        const localInertia = new Ammo.btVector3(0, 0, 0);
        const motionState = new Ammo.btDefaultMotionState(transform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, localInertia);
        const body = new Ammo.btRigidBody(rbInfo);

        physicsWorld.addRigidBody(body);
    }

    return chairGroup;
}
