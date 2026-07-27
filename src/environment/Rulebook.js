import * as THREE from 'three';
import { getPropAmmo, createPropStaticBody } from './PropPhysics.js';

export function createRulebook(
    scene,
    physicsWorld,
    position = { x: -8, y: -2.75, z: -8 },
    rotationY = Math.PI / 5
) {
    const group = new THREE.Group();
    group.name = 'Rulebook';

    const width = 4;
    const length = 5;
    const thickness = 0.8;

    // Cover material
    const coverMat = new THREE.MeshStandardMaterial({
        color: 0x3a0c0c, // Dark red leather
        roughness: 0.7,
        bumpScale: 0.02,
    });

    // Pages material
    const pagesMat = new THREE.MeshStandardMaterial({
        color: 0xf4e5c2, // Aged paper
        roughness: 0.9,
    });

    // Main body (pages)
    const pagesGeo = new THREE.BoxGeometry(width - 0.2, thickness - 0.1, length - 0.2);
    const pages = new THREE.Mesh(pagesGeo, pagesMat);
    pages.castShadow = true;
    pages.receiveShadow = true;
    group.add(pages);

    // Covers (Top, Bottom, Spine)
    const coverThick = 0.05;
    const topCoverGeo = new THREE.BoxGeometry(width, coverThick, length);
    const topCover = new THREE.Mesh(topCoverGeo, coverMat);
    topCover.position.y = thickness / 2 - coverThick / 2;
    topCover.castShadow = true;
    topCover.receiveShadow = true;
    group.add(topCover);

    const botCoverGeo = new THREE.BoxGeometry(width, coverThick, length);
    const botCover = new THREE.Mesh(botCoverGeo, coverMat);
    botCover.position.y = -thickness / 2 + coverThick / 2;
    botCover.castShadow = true;
    botCover.receiveShadow = true;
    group.add(botCover);

    const spineGeo = new THREE.BoxGeometry(coverThick, thickness, length);
    const spine = new THREE.Mesh(spineGeo, coverMat);
    spine.position.x = -width / 2 + coverThick / 2;
    spine.castShadow = true;
    spine.receiveShadow = true;
    group.add(spine);

    // Gold trim / Title placeholder
    const trimGeo = new THREE.BoxGeometry(width * 0.5, coverThick + 0.02, length * 0.3);
    const trimMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37, // Gold
        roughness: 0.3,
        metalness: 0.8,
    });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.y = thickness / 2 - coverThick / 2;
    trim.position.x = 0.2;
    trim.castShadow = true;
    group.add(trim);

    // Position
    // Table Top is -2.75.
    group.position.set(position.x, position.y + thickness / 2, position.z);
    group.rotation.y = rotationY;

    scene.add(group);

    // Physics
    const ammo = getPropAmmo();
    if (ammo && physicsWorld) {
        const shape = new ammo.btBoxShape(new ammo.btVector3(width / 2, thickness / 2, length / 2));
        createPropStaticBody(physicsWorld, group, shape);
    }

    return { group };
}
