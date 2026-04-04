import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

export function createLeatherJournal(
    scene,
    physicsWorld,
    position = { x: -4, y: -2.75, z: 2 },
    rotationY = Math.PI / 8
) {
    const group = new THREE.Group();
    group.name = 'LeatherJournal';
    const ammo = getAmmo();

    // Dimensions (feature branch values kept for realism)
    const width = 2.5;   // X - book width when closed
    const height = 0.6;  // Y - book thickness
    const depth = 3.5;   // Z - book length/height

    // --- Materials ---
    // Leather Cover (dark worn leather)
    const coverMat = new THREE.MeshStandardMaterial({
        color: 0x4a2e15,
        roughness: 0.8,
        metalness: 0.05,
        bumpScale: 0.02
    });

    // Parchment Pages (aged paper look from feature branch)
    const pagesMat = new THREE.MeshStandardMaterial({
        color: 0xeeddcc,
        roughness: 0.9,
        metalness: 0.0
    });

    // Ribbon Bookmark (dark red)
    const ribbonMat = new THREE.MeshStandardMaterial({
        color: 0x8b0000,
        roughness: 0.7,
        metalness: 0.1
    });

    // --- Visuals (detailed model from feature branch) ---

    // 1. Pages Block (slightly inset)
    const pagesWidth = width - 0.2;
    const pagesHeight = height - 0.1;
    const pagesDepth = depth - 0.2;
    const pagesGeo = new THREE.BoxGeometry(pagesWidth, pagesHeight, pagesDepth);
    const pagesMesh = new THREE.Mesh(pagesGeo, pagesMat);
    pagesMesh.position.x = 0.1; // Shift right so spine has solid cover
    pagesMesh.castShadow = true;
    pagesMesh.receiveShadow = true;
    group.add(pagesMesh);

    // 2. Cover Boards (top + bottom)
    const coverThickness = 0.05;
    const boardGeo = new THREE.BoxGeometry(width, coverThickness, depth);

    // Top cover
    const topCover = new THREE.Mesh(boardGeo, coverMat);
    topCover.position.y = pagesHeight / 2 + coverThickness / 2;
    topCover.castShadow = true;
    topCover.receiveShadow = true;
    group.add(topCover);

    // Bottom cover
    const botCover = new THREE.Mesh(boardGeo, coverMat);
    botCover.position.y = -(pagesHeight / 2 + coverThickness / 2);
    botCover.castShadow = true;
    botCover.receiveShadow = true;
    group.add(botCover);

    // 3. Spine (left edge, connecting covers)
    const spineWidth = 0.2;
    const spineGeo = new THREE.BoxGeometry(spineWidth, height, depth);
    const spineMesh = new THREE.Mesh(spineGeo, coverMat);
    spineMesh.position.x = -width / 2 + spineWidth / 2;
    spineMesh.castShadow = true;
    spineMesh.receiveShadow = true;
    group.add(spineMesh);

    // 4. Ribbon Bookmark (thin strip hanging out)
    const ribbonWidth = 0.3;
    const ribbonThickness = 0.01;
    const ribbonLength = 1.0;
    const ribbonGeo = new THREE.BoxGeometry(ribbonWidth, ribbonThickness, ribbonLength);
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.position.set(
        0.5,
        -height / 2 + 0.05,
        depth / 2 + ribbonLength / 2 - 0.1
    );
    ribbonMesh.rotation.x = -0.2; // Slight natural curve downward
    ribbonMesh.castShadow = true;
    ribbonMesh.receiveShadow = true;
    group.add(ribbonMesh);

    // --- Position & Rotation ---
    // Table top is usually Y = -2.75. Group origin is at center,
    // so we offset by half the book height to sit flat on the table.
    const finalY = position.y + height / 2;
    group.position.set(position.x, finalY, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // --- Physics (conditional + simple box from main branch) ---
    if (physicsWorld) {
        const shape = new ammo.btBoxShape(
            new ammo.btVector3(width / 2, height / 2, depth / 2)
        );
        createStaticBody(physicsWorld, group, shape);
    }

    return { group };
}