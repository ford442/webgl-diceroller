import * as THREE from 'three';
import { createProp } from './propKit.js';

export function createRulebook(
    scene,
    physicsWorld,
    position = { x: -8, y: -2.75, z: -8 },
    rotationY = Math.PI / 5
) {
    const width = 4;
    const length = 5;
    const thickness = 0.8;

    return createProp(scene, physicsWorld, {
        name: 'Rulebook',
        position,
        rotation: rotationY,
        footOffsetY: thickness / 2,
        colliders: [{ type: 'box', halfExtents: [width / 2, thickness / 2, length / 2] }],
        build({ group }) {
            const coverMat = new THREE.MeshStandardMaterial({
                color: 0x3a0c0c,
                roughness: 0.7,
                bumpScale: 0.02,
            });

            const pagesMat = new THREE.MeshStandardMaterial({
                color: 0xf4e5c2,
                roughness: 0.9,
            });

            const pagesGeo = new THREE.BoxGeometry(width - 0.2, thickness - 0.1, length - 0.2);
            const pages = new THREE.Mesh(pagesGeo, pagesMat);
            pages.castShadow = true;
            pages.receiveShadow = true;
            group.add(pages);

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

            const trimGeo = new THREE.BoxGeometry(width * 0.5, coverThick + 0.02, length * 0.3);
            const trimMat = new THREE.MeshStandardMaterial({
                color: 0xd4af37,
                roughness: 0.3,
                metalness: 0.8,
            });
            const trim = new THREE.Mesh(trimGeo, trimMat);
            trim.position.y = thickness / 2 - coverThick / 2;
            trim.position.x = 0.2;
            trim.castShadow = true;
            group.add(trim);
        },
    });
}
