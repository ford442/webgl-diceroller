import * as THREE from 'three';
import { createStaticBody, getAmmo } from '../physics.js';

export function createPencil(scene, physicsWorld) {
    const group = new THREE.Group();
    group.name = 'Pencil';

    const pencilRadius = 0.1;
    const bodyLength = 3;
    const tipLength = 0.5;
    const ferruleLength = 0.3;
    const eraserLength = 0.4;

    // Total length = tipLength + bodyLength + ferruleLength + eraserLength = 4.2

    // --- Materials ---
    // Yellow painted body
    const yellowPaintMat = new THREE.MeshStandardMaterial({
        color: 0xf4c542, // classic pencil yellow
        roughness: 0.4,
        metalness: 0.1
    });

    // Wood cone
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0xdeb887, // burlywood
        roughness: 0.8,
        metalness: 0.0
    });

    // Graphite tip
    const graphiteMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.3,
        metalness: 0.5
    });

    // Metal ferrule
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0xaaaaaa, // silver/aluminum
        roughness: 0.3,
        metalness: 0.8
    });

    // Pink eraser
    const eraserMat = new THREE.MeshStandardMaterial({
        color: 0xffb6c1, // light pink
        roughness: 0.9,
        metalness: 0.0
    });

    // --- Geometries ---
    // We will build the pencil aligned along the Y-axis (pointing UP).
    // This perfectly matches Ammo.btCylinderShape which expects Y-axis alignment.

    // Eraser (at the bottom, Y = 0 to eraserLength)
    const eraserGeo = new THREE.CylinderGeometry(pencilRadius, pencilRadius, eraserLength, 16);
    const eraserMesh = new THREE.Mesh(eraserGeo, eraserMat);
    eraserMesh.castShadow = true;
    eraserMesh.receiveShadow = true;
    eraserMesh.position.y = eraserLength / 2;
    group.add(eraserMesh);

    // Ferrule (Metal band)
    const ferruleGeo = new THREE.CylinderGeometry(pencilRadius + 0.01, pencilRadius + 0.01, ferruleLength, 16);
    const ferruleMesh = new THREE.Mesh(ferruleGeo, metalMat);
    ferruleMesh.castShadow = true;
    ferruleMesh.receiveShadow = true;
    ferruleMesh.position.y = eraserLength + ferruleLength / 2;
    group.add(ferruleMesh);

    // Hexagonal body for classic look (radialSegments = 6)
    const bodyGeo = new THREE.CylinderGeometry(pencilRadius, pencilRadius, bodyLength, 6);
    const bodyMesh = new THREE.Mesh(bodyGeo, yellowPaintMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    bodyMesh.position.y = eraserLength + ferruleLength + bodyLength / 2;
    group.add(bodyMesh);

    // Wood cone
    const coneGeo = new THREE.ConeGeometry(pencilRadius, tipLength, 16);
    const coneMesh = new THREE.Mesh(coneGeo, woodMat);
    coneMesh.castShadow = true;
    coneMesh.receiveShadow = true;
    coneMesh.position.y = eraserLength + ferruleLength + bodyLength + tipLength / 2;
    group.add(coneMesh);

    // Graphite point (small black cone at the very tip)
    const pointLength = 0.15;
    const pointRadius = pencilRadius * (pointLength / tipLength);
    const pointGeo = new THREE.ConeGeometry(pointRadius, pointLength, 16);
    const pointMesh = new THREE.Mesh(pointGeo, graphiteMat);
    pointMesh.castShadow = true;
    pointMesh.receiveShadow = true;
    pointMesh.position.y = eraserLength + ferruleLength + bodyLength + tipLength - pointLength / 2;
    group.add(pointMesh);

    // Center the entire pencil group on its local Y-axis origin
    const totalLength = tipLength + bodyLength + ferruleLength + eraserLength;
    group.children.forEach(c => {
        c.position.y -= totalLength / 2;
    });

    // Position on table near character sheet
    // Y = -2.75 is the table surface. Add radius so it rests on it.
    group.position.set(-2, -2.75 + pencilRadius, -4);

    // Rotate so it lays flat on the table.
    // The group's length is along its local Y-axis.
    // We rotate 90 degrees around X to lay it flat, and then around Y to point it.
    group.rotation.set(Math.PI / 2, -Math.PI / 4, 0, 'YXZ');

    scene.add(group);

    // Physics
    const Ammo = getAmmo();
    if (Ammo) {
        // Physics CylinderShape matches the Y-aligned group geometry perfectly.
        // Size: X=radius, Y=halfLength, Z=radius
        const shape = new Ammo.btCylinderShape(new Ammo.btVector3(pencilRadius, totalLength / 2, pencilRadius));
        createStaticBody(physicsWorld, group, shape);
    }

    return { group: group };
}
