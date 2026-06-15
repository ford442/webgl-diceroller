import * as THREE from 'three';
import { getAmmo } from '../physics.js';
import { getWoodTextures } from '../core/TexturePipeline.js';

export function createDMScreen(scene, physicsWorld, position = { x: 0, y: -2.75, z: -7 }, rotationY = 0) {
    const ammo = getAmmo();

    // Group to hold the screen
    const group = new THREE.Group();
    group.name = 'DMScreen';
    group.position.set(position.x, position.y, position.z);
    group.rotation.y = rotationY;

    const { diffuse: woodDiffuse, bump: woodBump, roughness: woodRoughness } = getWoodTextures();
    woodDiffuse.repeat.set(1, 1);
    woodBump.repeat.set(1, 1);
    woodRoughness.repeat.set(1, 1);
    woodBump.colorSpace = THREE.NoColorSpace;
    woodRoughness.colorSpace = THREE.NoColorSpace;

    // Wood Material
    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.05,
        roughnessMap: woodRoughness,
        roughness: 0.8,
        color: 0x8B5A2B // slightly darker wood tint
    });

    // Panel Dimensions
    const panelThickness = 0.2;
    const panelHeight = 4.0;
    const centerPanelWidth = 8.0;
    const sidePanelWidth = 4.0;
    const sidePanelAngle = Math.PI / 4; // 45 degrees

    // 1. Center Panel
    const centerGeom = new THREE.BoxGeometry(centerPanelWidth, panelHeight, panelThickness);
    const centerMesh = new THREE.Mesh(centerGeom, woodMaterial);
    centerMesh.position.set(0, panelHeight / 2, 0); // Bottom aligns with local Y=0
    centerMesh.castShadow = true;
    centerMesh.receiveShadow = true;
    group.add(centerMesh);

    // 2. Left Panel
    const sideGeom = new THREE.BoxGeometry(sidePanelWidth, panelHeight, panelThickness);
    const leftMesh = new THREE.Mesh(sideGeom, woodMaterial);

    // Position the left panel so its right edge attaches to the center panel's left edge
    const leftPivotX = -centerPanelWidth / 2;
    const leftPivotZ = -panelThickness / 2;

    // Offset local center to the pivot
    leftMesh.position.set(-sidePanelWidth / 2, 0, 0);

    const leftPivot = new THREE.Group();
    leftPivot.position.set(leftPivotX, panelHeight / 2, leftPivotZ);
    leftPivot.rotation.y = sidePanelAngle;
    leftPivot.add(leftMesh);
    group.add(leftPivot);

    // 3. Right Panel
    const rightMesh = new THREE.Mesh(sideGeom, woodMaterial);

    const rightPivotX = centerPanelWidth / 2;
    const rightPivotZ = -panelThickness / 2;

    rightMesh.position.set(sidePanelWidth / 2, 0, 0);

    const rightPivot = new THREE.Group();
    rightPivot.position.set(rightPivotX, panelHeight / 2, rightPivotZ);
    rightPivot.rotation.y = -sidePanelAngle;
    rightPivot.add(rightMesh);
    group.add(rightPivot);

    scene.add(group);

    // --- Physics ---
    // Create a compound shape for the 3 panels
    const compoundShape = new ammo.btCompoundShape();

    // Helper to add a box shape to the compound shape
    const addShape = (width, height, depth, posX, posY, posZ, rotY) => {
        const shape = new ammo.btBoxShape(new ammo.btVector3(width / 2, height / 2, depth / 2));
        const transform = new ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new ammo.btVector3(posX, posY, posZ));

        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        const btQuat = new ammo.btQuaternion(q.x, q.y, q.z, q.w);
        transform.setRotation(btQuat);

        compoundShape.addChildShape(transform, shape);
    };

    // Add Center Panel Shape
    addShape(centerPanelWidth, panelHeight, panelThickness, 0, panelHeight / 2, 0, 0);

    // Add Left Panel Shape
    // We need the world-relative (or group-relative) center of the left panel
    const leftCenter = new THREE.Vector3(-sidePanelWidth / 2, 0, 0);
    leftCenter.applyAxisAngle(new THREE.Vector3(0, 1, 0), sidePanelAngle);
    addShape(sidePanelWidth, panelHeight, panelThickness, leftPivotX + leftCenter.x, panelHeight / 2, leftPivotZ + leftCenter.z, sidePanelAngle);

    // Add Right Panel Shape
    const rightCenter = new THREE.Vector3(sidePanelWidth / 2, 0, 0);
    rightCenter.applyAxisAngle(new THREE.Vector3(0, 1, 0), -sidePanelAngle);
    addShape(sidePanelWidth, panelHeight, panelThickness, rightPivotX + rightCenter.x, panelHeight / 2, rightPivotZ + rightCenter.z, -sidePanelAngle);

    // Create the body
    const mass = 0; // Static body
    const localInertia = new ammo.btVector3(0, 0, 0);

    const transform = new ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new ammo.btVector3(position.x, position.y, position.z));

    const groupQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const btGroupQuat = new ammo.btQuaternion(groupQuat.x, groupQuat.y, groupQuat.z, groupQuat.w);
    transform.setRotation(btGroupQuat);

    const motionState = new ammo.btDefaultMotionState(transform);
    const rbInfo = new ammo.btRigidBodyConstructionInfo(mass, motionState, compoundShape, localInertia);
    const body = new ammo.btRigidBody(rbInfo);

    // Add friction and restitution
    body.setFriction(0.8);
    body.setRestitution(0.1);

    physicsWorld.addRigidBody(body);

    return { group, body };
}
