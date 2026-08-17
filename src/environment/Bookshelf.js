import * as THREE from 'three';
import { createProp, materials } from './propKit.js';

export function createBookshelf(
    scene,
    physicsWorld,
    position = { x: 0, y: 0, z: 0 },
    rotationY = 0
) {
    const width = 8;
    const height = 12;
    const depth = 2;
    const thickness = 0.5;

    return createProp(scene, physicsWorld, {
        name: 'Bookshelf',
        position,
        rotation: rotationY,
        colliders: [
            {
                type: 'box',
                halfExtents: [width / 2, height / 2, depth / 2],
                offset: { y: height / 2 },
            },
        ],
        build({ group, mesh: meshHelper }) {
            const wood = materials.woodTextured();
            const books = materials.bookCovers();
            const paper = materials.paper();

            const sideGeo = new THREE.BoxGeometry(thickness, height, depth);
            group.add(
                meshHelper(sideGeo, wood, {
                    position: { x: -width / 2 + thickness / 2, y: height / 2 },
                })
            );
            group.add(
                meshHelper(sideGeo, wood, {
                    position: { x: width / 2 - thickness / 2, y: height / 2 },
                })
            );

            const topBotGeo = new THREE.BoxGeometry(width, thickness, depth);
            group.add(meshHelper(topBotGeo, wood, { position: { y: height - thickness / 2 } }));
            group.add(meshHelper(topBotGeo, wood, { position: { y: thickness / 2 } }));

            const backGeo = new THREE.BoxGeometry(width, height, thickness);
            group.add(
                meshHelper(backGeo, wood, {
                    position: { y: height / 2, z: -depth / 2 + thickness / 2 },
                    castShadow: false,
                })
            );

            const numShelves = 4;
            const shelfSpacing = (height - thickness * 2) / numShelves;

            for (let i = 1; i < numShelves; i++) {
                const y = i * shelfSpacing;
                group.add(meshHelper(topBotGeo, wood, { position: { y } }));
                populateShelf(
                    group,
                    y,
                    width - thickness * 2,
                    depth - thickness,
                    books,
                    paper
                );
            }

            populateShelf(
                group,
                thickness / 2,
                width - thickness * 2,
                depth - thickness,
                books,
                paper
            );
        },
    });
}

function populateShelf(group, shelfY, shelfWidth, shelfDepth, coverMats, paperMat) {
    let currentX = -shelfWidth / 2 + 0.5;
    const maxX = shelfWidth / 2 - 0.5;

    while (currentX < maxX) {
        const bThick = 0.2 + Math.random() * 0.3;
        const bHeight = 1.5 + Math.random() * 0.8;
        const bDepth = shelfDepth * 0.8 + Math.random() * (shelfDepth * 0.1);

        if (currentX + bThick > maxX) break;

        if (Math.random() < 0.1) {
            currentX += 0.5 + Math.random() * 1.0;
            continue;
        }

        const lean = Math.random() < 0.2 ? Math.random() * 0.3 - 0.15 : 0;
        const book = createBookMesh(bThick, bHeight, bDepth, coverMats, paperMat);
        const surfaceY = shelfY + 0.25;

        book.position.set(currentX + bThick / 2, surfaceY + bHeight / 2, 0);
        book.rotation.z = lean;
        book.position.z = (Math.random() - 0.5) * 0.2;

        group.add(book);
        currentX += bThick + 0.02;
    }
}

function createBookMesh(width, height, depth, coverMats, _paperMat) {
    const mat = coverMats[Math.floor(Math.random() * coverMats.length)];
    const book = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    book.castShadow = true;
    book.receiveShadow = true;
    return book;
}
