import * as THREE from 'three';
import { getAmmo, createStaticBody } from '../physics.js';

// Cache materials to avoid reloading textures on multiple calls
let sharedMaterials = null;

function getMaterials() {
    if (sharedMaterials) return sharedMaterials;

    const loader = new THREE.TextureLoader();

    // Wood Material
    const woodDiffuse = loader.load('/images/wood_diffuse.jpg');
    const woodBump = loader.load('/images/wood_bump.jpg');
    const woodRoughness = loader.load('/images/wood_roughness.jpg');

    [woodDiffuse, woodBump, woodRoughness].forEach(t => {
        t.colorSpace = (t === woodDiffuse) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    });

    const woodMaterial = new THREE.MeshStandardMaterial({
        map: woodDiffuse,
        bumpMap: woodBump,
        bumpScale: 0.1,
        roughnessMap: woodRoughness,
        color: 0x8B4513, // SaddleBrown
        roughness: 0.8
    });

    // Book Materials (Palette)
    const bookColors = [
        0x8b0000, // Dark Red
        0x006400, // Dark Green
        0x00008b, // Dark Blue
        0x2f4f4f, // Dark Slate Gray
        0x8b4513, // Saddle Brown
        0x000000  // Black
    ];
    const bookMaterials = bookColors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    const paperMaterial = new THREE.MeshStandardMaterial({ color: 0xfffff0, roughness: 0.9 }); // Pages

    sharedMaterials = {
        wood: woodMaterial,
        books: bookMaterials,
        paper: paperMaterial
    };

    return sharedMaterials;
}

export function createBookshelf(scene, physicsWorld, position = { x: 0, y: 0, z: 0 }, rotationY = 0) {
    const materials = getMaterials();
    const ammo = getAmmo();

    // Group
    const bookshelfGroup = new THREE.Group();
    bookshelfGroup.position.set(position.x, position.y, position.z);
    bookshelfGroup.rotation.y = rotationY;

    // --- Geometry ---
    // Bookshelf Dimensions
    const width = 8;
    const height = 12;
    const depth = 2;
    const thickness = 0.5;

    // 1. Frame
    // Left Side
    const sideGeo = new THREE.BoxGeometry(thickness, height, depth);
    const leftSide = new THREE.Mesh(sideGeo, materials.wood);
    leftSide.position.set(-width/2 + thickness/2, height/2, 0);
    leftSide.castShadow = true;
    leftSide.receiveShadow = true;
    bookshelfGroup.add(leftSide);

    // Right Side
    const rightSide = new THREE.Mesh(sideGeo, materials.wood);
    rightSide.position.set(width/2 - thickness/2, height/2, 0);
    rightSide.castShadow = true;
    rightSide.receiveShadow = true;
    bookshelfGroup.add(rightSide);

    // Top
    const topBotGeo = new THREE.BoxGeometry(width, thickness, depth);
    const top = new THREE.Mesh(topBotGeo, materials.wood);
    top.position.set(0, height - thickness/2, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    bookshelfGroup.add(top);

    // Bottom
    const bottom = new THREE.Mesh(topBotGeo, materials.wood);
    bottom.position.set(0, thickness/2, 0);
    bottom.castShadow = true;
    bottom.receiveShadow = true;
    bookshelfGroup.add(bottom);

    // Back
    const backGeo = new THREE.BoxGeometry(width, height, thickness);
    const back = new THREE.Mesh(backGeo, materials.wood);
    back.position.set(0, height/2, -depth/2 + thickness/2);
    back.receiveShadow = true;
    bookshelfGroup.add(back);

    // Shelves
    const numShelves = 4;
    const shelfSpacing = (height - thickness * 2) / numShelves;

    for (let i = 1; i < numShelves; i++) {
        const y = i * shelfSpacing;
        const shelf = new THREE.Mesh(topBotGeo, materials.wood);
        shelf.position.set(0, y, 0);
        shelf.castShadow = true;
        shelf.receiveShadow = true;
        bookshelfGroup.add(shelf);

        // Populate with Books
        populateShelf(bookshelfGroup, y, width - thickness*2, depth - thickness, materials.books, materials.paper);
    }

    // Populate bottom shelf too
    populateShelf(bookshelfGroup, thickness/2, width - thickness*2, depth - thickness, materials.books, materials.paper);


    scene.add(bookshelfGroup);

    // --- Physics ---
    // Simple Box Shape for the whole unit
    if (ammo) {
        const shape = new ammo.btBoxShape(new ammo.btVector3(width/2, height/2, depth/2));

        // Adjust center for physics body (created at center of mass)
        // Group is at 'position'. Center of bookshelf logic is at y=height/2 relative to position.
        // createStaticBody uses mesh position.
        // We can attach physics to a hidden proxy mesh at the center.

        const proxyGeo = new THREE.BoxGeometry(width, height, depth);
        const proxyMesh = new THREE.Mesh(proxyGeo);
        proxyMesh.visible = false;
        proxyMesh.position.set(position.x, position.y + height/2, position.z);
        // Apply rotation
        proxyMesh.rotation.y = rotationY;

        // Just add to scene invisibly to track transform
        scene.add(proxyMesh);

        createStaticBody(physicsWorld, proxyMesh, shape);
    }
}

function populateShelf(group, shelfY, shelfWidth, shelfDepth, coverMats, paperMat) {
    let currentX = -shelfWidth / 2 + 0.5; // Start from left with padding
    const maxX = shelfWidth / 2 - 0.5;

    while (currentX < maxX) {
        // Random Book Dimensions
        const bThick = 0.2 + Math.random() * 0.3;
        const bHeight = 1.5 + Math.random() * 0.8;
        const bDepth = shelfDepth * 0.8 + Math.random() * (shelfDepth * 0.1);

        if (currentX + bThick > maxX) break;

        // Chance to skip (gap)
        if (Math.random() < 0.1) {
            currentX += 0.5 + Math.random() * 1.0;
            continue;
        }

        // Chance to lean
        const lean = (Math.random() < 0.2) ? (Math.random() * 0.3 - 0.15) : 0;

        const book = createBookMesh(bThick, bHeight, bDepth, coverMats, paperMat);

        // Position
        // On top of shelf: shelfY + thickness/2 (shelf thick is 0.5) + bHeight/2?
        // Wait, shelfY is center of shelf board. Shelf board thickness is 0.5.
        // Surface is at shelfY + 0.25.
        const surfaceY = shelfY + 0.25;

        book.position.set(currentX + bThick/2, surfaceY + bHeight/2, 0);
        book.rotation.z = lean;

        // Randomize depth slightly
        book.position.z = (Math.random() - 0.5) * 0.2;

        group.add(book);

        currentX += bThick + 0.02; // Gap
    }
}

function createBookMesh(width, height, depth, coverMats, paperMat) {
    const mat = coverMats[Math.floor(Math.random() * coverMats.length)];
    const book = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    book.castShadow = true;
    book.receiveShadow = true;
    return book;
}
