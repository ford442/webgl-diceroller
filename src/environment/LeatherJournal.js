import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createLeatherJournal(scene, physicsWorld, position = { x: -4, y: -2.75, z: 2 }, rotationY = Math.PI / 8) {
    const group = new THREE.Group();
    group.name = 'LeatherJournal';

    const ammo = getAmmo();

    // Dimensions
    const width = 2.5;  // Width of the book (X)
    const height = 0.6; // Thickness of the book (Y)
    const depth = 3.5;  // Length of the book (Z)

    // --- Materials ---
    // Leather Cover
    const coverMat = new THREE.MeshStandardMaterial({
        color: 0x4a2e15, // Dark worn leather
        roughness: 0.8,
        metalness: 0.05,
        bumpScale: 0.02
    });

    // Parchment Pages
    const pagesMat = new THREE.MeshStandardMaterial({
        color: 0xeeddcc, // Aged paper
        roughness: 0.9,
        metalness: 0.0
    });

    // Ribbon Bookmark
    const ribbonMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000, // Dark red
        roughness: 0.7,
        metalness: 0.1
    });

    // --- Visuals ---

    // 1. Pages Block
    const pagesWidth = width - 0.2;
    const pagesHeight = height - 0.1;
    const pagesDepth = depth - 0.2;
    const pagesGeo = new THREE.BoxGeometry(pagesWidth, pagesHeight, pagesDepth);
    const pagesMesh = new THREE.Mesh(pagesGeo, pagesMat);
    pagesMesh.castShadow = true;
    pagesMesh.receiveShadow = true;
    group.add(pagesMesh);

    // 2. Cover Boards
    const coverThickness = 0.05;
    const boardGeo = new THREE.BoxGeometry(width, coverThickness, depth);

    // Top Cover
    const topCover = new THREE.Mesh(boardGeo, coverMat);
    topCover.position.y = pagesHeight / 2 + coverThickness / 2;
    topCover.castShadow = true;
    topCover.receiveShadow = true;
    group.add(topCover);

    // Bottom Cover
    const botCover = new THREE.Mesh(boardGeo, coverMat);
    botCover.position.y = -(pagesHeight / 2 + coverThickness / 2);
    botCover.castShadow = true;
    botCover.receiveShadow = true;
    group.add(botCover);

    // Spine
    // The spine connects the top and bottom covers on the left edge (-X)
    const spineWidth = 0.2;
    const spineGeo = new THREE.BoxGeometry(spineWidth, height, depth);
    const spineMesh = new THREE.Mesh(spineGeo, coverMat);
    spineMesh.position.x = -width / 2 + spineWidth / 2;
    spineMesh.castShadow = true;
    spineMesh.receiveShadow = true;
    group.add(spineMesh);

    // Move pages slightly to the right to make room for the spine
    pagesMesh.position.x = 0.1;

    // 3. Ribbon Bookmark
    // A thin strip sticking out from the bottom
    const ribbonWidth = 0.3;
    const ribbonLength = 1.0;
    const ribbonThickness = 0.01;
    const ribbonGeo = new THREE.BoxGeometry(ribbonWidth, ribbonThickness, ribbonLength);
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.position.set(0.5, -height / 2 + 0.05, depth / 2 + ribbonLength / 2 - 0.1);
    // Add a slight curve down
    ribbonMesh.rotation.x = -0.2;
    ribbonMesh.castShadow = true;
    ribbonMesh.receiveShadow = true;
    group.add(ribbonMesh);

    // --- Position ---
    // Table top is around Y=-2.75
    // The origin of the group is the center. So bottom is at -height/2 (-0.3).
    // To place it on the table, Y = tableY + height/2
    const finalY = position.y + height / 2;
    group.position.set(position.x, finalY, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics ---
    // Use half-extents for btBoxShape
    const shape = new ammo.btBoxShape(new ammo.btVector3(width / 2, height / 2, depth / 2));
    createStaticBody(physicsWorld, group, shape);

    return {
        group
    };
}
