import * as THREE from 'three';
import { createProp } from './propKit.js';
import { getBookCoverMaterial, getPaperMaterial } from '../core/MaterialPalette.js';

export function createMysticTome(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotationY = 0
) {
    const group = new THREE.Group();
    group.name = 'MysticTome';

    const width = 3;
    const length = 4;
    const thickness = 1.2;
    const coverThick = 0.1;

    // Materials
    const coverMat = getBookCoverMaterial({
        color: 0x1a0f2e, // Deep mystical purple/black
        roughness: 0.6,
        bumpScale: 0.05,
    });
    const pagesMat = getPaperMaterial({ color: 0xe6dfc8 }); // Slightly aged parchment

    // Pages
    const pagesGeo = new THREE.BoxGeometry(width - 0.2, thickness - 0.2, length - 0.2);
    const pages = new THREE.Mesh(pagesGeo, pagesMat);
    pages.castShadow = true;
    pages.receiveShadow = true;
    group.add(pages);

    // Top Cover
    const topCoverGeo = new THREE.BoxGeometry(width, coverThick, length);
    const topCover = new THREE.Mesh(topCoverGeo, coverMat);
    topCover.position.y = thickness / 2 - coverThick / 2;
    topCover.castShadow = true;
    topCover.receiveShadow = true;
    group.add(topCover);

    // Bottom Cover
    const botCoverGeo = new THREE.BoxGeometry(width, coverThick, length);
    const botCover = new THREE.Mesh(botCoverGeo, coverMat);
    botCover.position.y = -thickness / 2 + coverThick / 2;
    botCover.castShadow = true;
    botCover.receiveShadow = true;
    group.add(botCover);

    // Spine
    const spineGeo = new THREE.BoxGeometry(coverThick, thickness, length);
    const spine = new THREE.Mesh(spineGeo, coverMat);
    spine.position.x = -width / 2 + coverThick / 2;
    spine.castShadow = true;
    spine.receiveShadow = true;
    group.add(spine);

    // Mystical Sigil (Gold trim)
    const sigilGeo = new THREE.CylinderGeometry(width * 0.3, width * 0.3, coverThick + 0.02, 6);
    const sigilMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37, // Gold
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x5a2a8a, // Faint magical glow
        emissiveIntensity: 0.2,
    });
    const sigil = new THREE.Mesh(sigilGeo, sigilMat);
    sigil.position.y = thickness / 2 - coverThick / 2;
    sigil.position.x = 0.2;
    sigil.rotation.y = Math.PI / 6;
    sigil.castShadow = true;
    group.add(sigil);

    return createProp({
        scene,
        physicsWorld,
        mesh: group,
        position,
        rotationY,
        yOffset: thickness / 2, // Center of box is elevated by half thickness
        physics: {
            type: 'box',
            halfExtents: [width / 2, thickness / 2, length / 2]
        }
    });
}
