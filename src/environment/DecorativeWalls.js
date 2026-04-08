import { createBookshelf } from './Bookshelf.js';

export function createDecorativeWalls(scene, physicsWorld) {
    // Add additional bookshelves around the tavern to act as "visible" decorative walls.
    // The main room is 40x40. We will place bookshelves against the side walls.

    // Left Wall Bookshelves
    createBookshelf(scene, physicsWorld, { x: -18, y: -10, z: -10 }, Math.PI / 2);
    createBookshelf(scene, physicsWorld, { x: -18, y: -10, z: 10 }, Math.PI / 2);

    // Right Wall Bookshelves
    createBookshelf(scene, physicsWorld, { x: 18, y: -10, z: 0 }, -Math.PI / 2);
    createBookshelf(scene, physicsWorld, { x: 18, y: -10, z: 10 }, -Math.PI / 2);
    createBookshelf(scene, physicsWorld, { x: 18, y: -10, z: -10 }, -Math.PI / 2);

    // Back Wall Bookshelves
    createBookshelf(scene, physicsWorld, { x: -10, y: -10, z: -18 }, 0);
    createBookshelf(scene, physicsWorld, { x: 10, y: -10, z: -18 }, 0);
    // (There is a bookshelf at {x: -18, y: -10, z: 0} in main.js, we won't overlap it)
}
